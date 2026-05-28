# OOC-3 P4 Implementation Plan: root 原型 + defaultContext

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** 在 ooc-3 worktree 上落 P4 (root builtin prototype + defaultContext)，让 loader 能加载真实 server module，每个 Object 继承 root 的方法库与默认 context 切片组装。

**Architecture:** 扩展 loader 动态 import `server/index.ts` 与 `client/index.tsx`；定义 ServerMap / ServerMethod 类型与 defineObject 助手；在 `stones/_builtin/objects/root/` 落地完整的 root 原型，含 self.md + readme.md + server/index.ts (含 13 个 public 方法的 skeleton + defaultContext 真实实现) + client/index.tsx 兜底 UI 占位。

**Tech Stack:** TypeScript (bun runtime), bun:test, dynamic ES import, React (tsx 类型先 skip if vite未 setup)。

**Reference docs:**
- spec V2: `docs/superpowers/specs/2026-05-28-ooc-object-unification-design.md` §2.4 + §3 + §5.2
- meta concept: `meta/object.doc.ts` (4 关系轴 / 8 维度 / b_class_collapse)
- existing infrastructure: P2 + P3 modules in `src/persistable/` + `src/executable/`

**Out of scope (next plans):**
- B 类塌缩字段 method body 实装（talks/threads/todos/plan 写入 + 直投回路）—— P5
- 自动 flow 创建机制 —— P5
- HTTP / Web AppShell 集成 —— P7
- A 类 ephemeral Object 创建路径 —— P6

P4 的 method body 是 skeleton：参数校验 + 返回结构化结果占位 + TODO 注释指向 P5。

---

## File Structure

```
ooc-3-wt/
├── tsconfig.json                                # 修改：include stones/
├── src/
│   └── executable/
│       ├── server.ts                            # 新写：ServerMethod / ServerMap / defineObject 类型与助手
│       ├── loader.ts                            # 修改：扩展为动态 import server/index.ts
│       └── __tests__/
│           ├── server.test.ts                   # 新写
│           └── loader-with-server.test.ts       # 新写
└── stones/
    └── _builtin/
        └── objects/
            └── root/
                ├── self.md                      # 新写：身份 + extends: null + frontmatter
                ├── readme.md                    # 新写：对外说明
                ├── server/
                │   └── index.ts                 # 新写：13 public methods + defaultContext + private helpers
                ├── client/
                │   └── index.tsx                # 新写：兜底 UI 占位（SSR-safe React 组件）
                └── __tests__/
                    └── default-context.test.ts  # 新写：defaultContext 组装验证
```

**File responsibility:**
- `src/executable/server.ts`: ServerMap type + defineObject() helper + ObjectContext type (passed into method calls)
- `src/executable/loader.ts` 修改：dynamic import server/index.ts；填充 ObjectRecord.serverPublic / serverPrivate; 同时 import client/index.tsx (lazy)
- `stones/_builtin/objects/root/`: builtin 根原型；defaultContext() 真实组装；其他方法 body 为 skeleton（参数校验 + 返回 placeholder）

---

### Task 1: 更新 tsconfig.json include stones/

**Files:**
- Modify: `/Users/zhangzhefu/x/ooc-2/ooc-3-wt/tsconfig.json`

- [ ] **Step 1: Read current tsconfig**

```bash
cd /Users/zhangzhefu/x/ooc-2/ooc-3-wt && cat tsconfig.json
```

- [ ] **Step 2: Add `stones/**/*.ts` and `stones/**/*.tsx` to include array**

Use Edit on `include` array — add two entries after existing `.ooc-world/stones/**/*.ts` (if present) or as new lines:

Final include array should contain:
```json
"include": [
  "src/**/*.ts",
  "src/**/*.tsx",
  "meta/**/*.js",
  "meta/**/*.ts",
  "tests/**/*.ts",
  "stones/**/*.ts",
  "stones/**/*.tsx",
  ".ooc-world/stones/**/*.ts"
]
```

(Add `src/**/*.tsx` too so future React components in src/ compile.)

- [ ] **Step 3: Verify tsc still 0 errors**

```bash
cd /Users/zhangzhefu/x/ooc-2/ooc-3-wt && bunx tsc --noEmit
```

- [ ] **Step 4: Stage**

```bash
git add tsconfig.json
```

---

### Task 2: 写 src/executable/server.ts (ServerMethod 类型 + defineObject 助手)

**Files:**
- Create: `/Users/zhangzhefu/x/ooc-2/ooc-3-wt/src/executable/server.ts`

定义 method dispatch 的核心类型。

- [ ] **Step 1: Write file**

```typescript
/**
 * Object server 类型：定义 method body 接收/返回的契约。
 *
 * 详见 spec §3.6 (方法可见性 vs 调用边界) + §3.1 (统一调用形式)。
 */

import type { ObjectRecord } from "../persistable/object-record";

/**
 * Method 调用时传给 body 的运行时上下文。
 *
 * - record: 被调方法所属 Object 的 record（含三层 paths）
 * - worldRoot: world 根目录绝对路径
 * - sessionId: 当前活跃 session id（除离线场景外应总有值）
 * - registry: 反向引用 ObjectRegistry，允许 method 内部查询其他 Object（如 talk 找 peer）
 */
export type ObjectContext = {
    record: ObjectRecord;
    worldRoot: string;
    sessionId?: string;
    registry: import("./registry").ObjectRegistry;
};

/**
 * 单个方法的签名：接 args + ctx → 异步结果。
 *
 * args 类型留给具体方法声明 (`args: any` 这里是最 permissive)；实际方法应自己定义具体 args 类型。
 */
export type ServerMethod<TArgs = unknown, TResult = unknown> = (
    args: TArgs,
    ctx: ObjectContext,
) => Promise<TResult>;

/**
 * Object 自定义的 method 集合，按 public / private 分组。
 *
 * public: LLM 看见 + 可通过 emit action 调用 + 跨 Object 可调用
 * private: 只允许同 Object 内部 method body 调用（参 spec §3.6 矩阵）
 */
export type ServerMap = {
    public: Record<string, ServerMethod>;
    private: Record<string, ServerMethod>;
};

/**
 * defineObject: 类型守卫的便捷构造函数，让 server/index.ts 写法清晰。
 *
 * 用法：
 * ```ts
 * import { defineObject } from "@src/executable/server";
 *
 * export default defineObject({
 *   public: {
 *     async talk(args, ctx) { ... },
 *   },
 *   private: {
 *     async _helper(args, ctx) { ... },
 *   },
 * });
 * ```
 */
export function defineObject(map: ServerMap): ServerMap {
    return map;
}

/**
 * Method 不存在时统一错误类型。
 */
export class MethodNotFoundError extends Error {
    constructor(public methodName: string, public objectUri: string) {
        super(`Method "${methodName}" not found on Object ${objectUri}`);
        this.name = "MethodNotFoundError";
    }
}

/**
 * 调用 public method 但对方法 private 的错误。
 */
export class MethodNotPublicError extends Error {
    constructor(public methodName: string, public objectUri: string) {
        super(`Method "${methodName}" is private and not invokable from outside on Object ${objectUri}`);
        this.name = "MethodNotPublicError";
    }
}
```

- [ ] **Step 2: Write test**

Create `/Users/zhangzhefu/x/ooc-2/ooc-3-wt/src/executable/__tests__/server.test.ts`:

```typescript
import { describe, expect, test } from "bun:test";
import {
    defineObject,
    MethodNotFoundError,
    MethodNotPublicError,
    type ServerMap,
} from "../server";

describe("server.defineObject", () => {
    test("returns identity SeverMap", () => {
        const map: ServerMap = defineObject({
            public: {
                async foo() { return "foo"; },
            },
            private: {
                async _bar() { return "bar"; },
            },
        });
        expect(typeof map.public.foo).toBe("function");
        expect(typeof map.private._bar).toBe("function");
    });

    test("MethodNotFoundError caries name + uri", () => {
        const e = new MethodNotFoundError("nope", "ooc://stones/main/objects/foo");
        expect(e.methodName).toBe("nope");
        expect(e.objectUri).toBe("ooc://stones/main/objects/foo");
        expect(e.message).toContain("not found");
    });

    test("MethodNotPublicError caries name + uri", () => {
        const e = new MethodNotPublicError("_bar", "ooc://stones/main/objects/foo");
        expect(e.methodName).toBe("_bar");
        expect(e.objectUri).toBe("ooc://stones/main/objects/foo");
        expect(e.message).toContain("private");
    });
});
```

- [ ] **Step 3: tsc + test**

```bash
cd /Users/zhangzhefu/x/ooc-2/ooc-3-wt && bunx tsc --noEmit src/executable/server.ts src/executable/__tests__/server.test.ts
cd /Users/zhangzhefu/x/ooc-2/ooc-3-wt && bun test src/executable/__tests__/server.test.ts
```
Expected: 3 tests pass.

- [ ] **Step 4: Stage**

```bash
git add src/executable/server.ts src/executable/__tests__/server.test.ts
```

---

### Task 3: 扩展 src/executable/loader.ts 动态加载 server module

**Files:**
- Modify: `/Users/zhangzhefu/x/ooc-2/ooc-3-wt/src/executable/loader.ts`
- Modify: `/Users/zhangzhefu/x/ooc-2/ooc-3-wt/src/persistable/object-record.ts`
- Create test: `/Users/zhangzhefu/x/ooc-2/ooc-3-wt/src/executable/__tests__/loader-with-server.test.ts`

让 loader 扫描时也尝试 dynamic import `server/index.ts` 的 default export，填充 ObjectRecord.serverPublic / serverPrivate。

- [ ] **Step 1: 修改 object-record.ts 增加可选 server 字段**

Read current `src/persistable/object-record.ts`. Add to `ObjectRecord` type two optional fields:

```typescript
export type ObjectRecord = {
    uri: string;
    paths: ObjectPaths;
    kind: ObjectKind;
    self: SelfFrontmatter;
    /** 由 loader 动态 import server/index.ts 填充；自身没有 server 文件时为 undefined */
    serverPublic?: Record<string, unknown>;
    serverPrivate?: Record<string, unknown>;
};
```

（用 `Record<string, unknown>` 避免在 persistable 层依赖 executable 层；执行时再 cast。）

- [ ] **Step 2: 修改 loader.ts 增加 import-server 逻辑**

Read current `src/executable/loader.ts`. Add a helper after the existing imports:

```typescript
/**
 * 尝试 dynamic import objectDir/server/index.ts 的 default export。
 * 不存在则返回 null（不视为错误）。
 */
async function loadServerModule(
    objectDir: string,
): Promise<{ public: Record<string, unknown>; private: Record<string, unknown> } | null> {
    const serverPath = path.join(objectDir, "server", "index.ts");
    try {
        await fs.access(serverPath);
    } catch {
        return null;
    }
    try {
        const mod = await import(serverPath);
        const def = mod.default;
        if (!def || typeof def !== "object") return null;
        const pub = def.public && typeof def.public === "object" ? def.public : {};
        const priv = def.private && typeof def.private === "object" ? def.private : {};
        return { public: pub, private: priv };
    } catch (err) {
        // bun import failure should surface, not silently swallow
        throw new Error(
            `Failed to import server module at ${serverPath}: ${(err as Error).message}`,
        );
    }
}
```

然后在 `loadObjects` 函数内：每次 push records 之前，调用 `loadServerModule(stonePath/flowPath)`，把返回的 public/private 填入 record。即在每个分支：

- builtin 分支：`const server = await loadServerModule(stonePath); records.push({ ..., serverPublic: server?.public, serverPrivate: server?.private });`
- branch persistent 分支：同上但用 stonePath
- flow ephemeral 分支：同上但用 flowPath

- [ ] **Step 3: tsc 验证**

```bash
cd /Users/zhangzhefu/x/ooc-2/ooc-3-wt && bunx tsc --noEmit
```

- [ ] **Step 4: 写测试 loader-with-server.test.ts**

Create:

```typescript
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { loadObjects } from "../loader";

describe("loader: 动态加载 server module", () => {
    let world: string;

    beforeEach(async () => {
        world = await fs.mkdtemp(path.join(os.tmpdir(), "ooc-loader-server-"));
    });

    afterEach(async () => {
        await fs.rm(world, { recursive: true, force: true });
    });

    async function write(p: string, body: string) {
        await fs.mkdir(path.dirname(p), { recursive: true });
        await fs.writeFile(p, body);
    }

    test("Object 无 server/ 则 serverPublic/Private 为 undefined", async () => {
        await write(
            path.join(world, "stones", "_builtin", "objects", "foo", "self.md"),
            "---\n---\n# foo\n",
        );
        const records = await loadObjects({ worldRoot: world });
        expect(records).toHaveLength(1);
        expect(records[0].serverPublic).toBeUndefined();
        expect(records[0].serverPrivate).toBeUndefined();
    });

    test("Object 有 server/index.ts 则 public/private 都被填充", async () => {
        const objectDir = path.join(world, "stones", "_builtin", "objects", "bar");
        await write(path.join(objectDir, "self.md"), "---\n---\n# bar\n");
        await write(
            path.join(objectDir, "server", "index.ts"),
            `export default {
                public: {
                    async hello() { return "world"; }
                },
                private: {
                    async _internal() { return 42; }
                }
            };`,
        );
        const records = await loadObjects({ worldRoot: world });
        expect(records).toHaveLength(1);
        expect(records[0].serverPublic).toBeDefined();
        expect(typeof records[0].serverPublic!.hello).toBe("function");
        expect(records[0].serverPrivate).toBeDefined();
        expect(typeof records[0].serverPrivate!._internal).toBe("function");
    });

    test("server module 异常时抛错", async () => {
        const objectDir = path.join(world, "stones", "_builtin", "objects", "broken");
        await write(path.join(objectDir, "self.md"), "---\n---\n");
        await write(
            path.join(objectDir, "server", "index.ts"),
            "this is not valid typescript syntax !!!",
        );
        await expect(loadObjects({ worldRoot: world })).rejects.toThrow(
            /Failed to import server module/,
        );
    });
});
```

- [ ] **Step 5: 跑测试**

```bash
cd /Users/zhangzhefu/x/ooc-2/ooc-3-wt && bun test src/executable/__tests__/loader-with-server.test.ts
```
Expected: 3 tests pass。

- [ ] **Step 6: 跑所有 executable 测试确保未破坏 P3**

```bash
cd /Users/zhangzhefu/x/ooc-2/ooc-3-wt && bun test src/executable/
```
Expected: P3 19 tests + Server 3 + loader-with-server 3 = 25 PASS。

- [ ] **Step 7: stage**

```bash
git add src/persistable/object-record.ts src/executable/loader.ts src/executable/__tests__/loader-with-server.test.ts
```

---

### Task 4: 写 stones/_builtin/objects/root/self.md

**Files:**
- Create: `/Users/zhangzhefu/x/ooc-2/ooc-3-wt/stones/_builtin/objects/root/self.md`

- [ ] **Step 1: mkdir + write**

```bash
cd /Users/zhangzhefu/x/ooc-2/ooc-3-wt && mkdir -p stones/_builtin/objects/root/server stones/_builtin/objects/root/client stones/_builtin/objects/root/__tests__
```

Write `stones/_builtin/objects/root/self.md`:

```markdown
---
title: root
extends: null
description: |
  OOC-3 根原型（builtin prototype root of all OOC Objects）。
  任何 Object 默认 extends: root（除非 self.md 显式覆盖）。
  提供 8 个 builtin prototype（program/search/file/knowledge/command_exec/skill_index/custom/talk-like wrappers）的 fallback 方法库。
---

# root prototype

我是 OOC-3 系统中所有 OOC Object 的根原型。

## 我提供什么

我的 server/index.ts 暴露了一组 public method，作为所有 OOC Object 的"出厂方法库"：

- **协作类**: `talk` （peer 之间消息直投，flow 层 append + 唤起 target LLM）
- **派生类**: `do` / `do_close` （内部 spawn sub-thread，flow 层独立 thread.json）
- **任务类**: `todo_add` / `todo_check` / `todo_uncheck` / `todo_remove` / `todo_list` （flow 层 todos.json mutate）
- **引导类**: `plan_set` / `plan_clear` （flow 层 plan.md 当前 thread 引导）
- **搜索类**: `grep` / `glob` （创建 ephemeral search Object 到 flows/<session>/objects/）
- **打开类**: `open_file` / `open_knowledge` （创建 ephemeral file/knowledge Object）
- **元编程**: `metaprog` / `write_file` （改自己的 stone；走 super flow 协议）
- **结束**: `end` （主 thread 主动 close）

子原型 Object 通过 `extends: root` 继承这些方法；任意一个可被 override。

## 我的 defaultContext

每轮 LLM 调用前由 root 原型的 `defaultContext()` 实时拼装：

1. active plan（如 plan.md 非空，顶置注入）
2. unfinished todos（todos.json 中 checked=false 项）
3. active threads（flows/<session>/objects/<self>/threads/ 中未 close 的子线程）
4. recent talks（每 peer 最近 N 条消息摘要）
5. relations（同级 + children/ Object 列表）

子原型可在自己 server/ 内 override `defaultContext()` 增/减切片。

## 设计参考

详见 spec V2 §2.4 + §3 + §5.2 + meta/object.doc.ts:patches.b_class_collapse。
```

- [ ] **Step 2: Write readme.md**

```markdown
# root prototype (外部说明)

OOC-3 的"出厂 Object 根原型"。所有 OOC Object 默认 `extends: root`，继承 root 暴露的 13 个 public method 与 defaultContext 切片组装。

子原型（program / search / file / knowledge / command_exec / skill_index / custom）通过 `extends: root` 继承；如需特化某方法，在自身 server/index.ts override 即可。

详见 root.self.md。
```

Write to `stones/_builtin/objects/root/readme.md`.

- [ ] **Step 3: Stage**

```bash
git add stones/_builtin/objects/root/self.md stones/_builtin/objects/root/readme.md
```

---

### Task 5: 写 stones/_builtin/objects/root/server/index.ts (skeleton methods + defaultContext)

**Files:**
- Create: `/Users/zhangzhefu/x/ooc-2/ooc-3-wt/stones/_builtin/objects/root/server/index.ts`

root 原型完整 server。Methods 暂时是 skeleton（参数 + 占位返回 + TODO 标 P5）；`defaultContext()` 实装为真实拼装。

- [ ] **Step 1: 写 server/index.ts**

```typescript
/**
 * stones/_builtin/objects/root/server/index.ts
 *
 * OOC-3 根原型的 server method 集合。
 *
 * P4 阶段: methods 是 skeleton (参数解析 + 占位返回 + TODO 标 P5)；
 *          defaultContext() 是真实实装（按 spec §3.5）。
 *
 * 详见 spec V2 §3 + meta/object.doc.ts:patches.b_class_collapse。
 */

import { promises as fs } from "node:fs";
import * as path from "node:path";
import { defineObject, type ObjectContext } from "@src/executable/server";

/* -------------------- defaultContext: 真实实装 -------------------- */

/**
 * defaultContext slice 结构：每轮 LLM 调用前拼装的 context 部分。
 */
export type DefaultContextSlice = {
    kind: "plan" | "todos" | "threads" | "talks" | "relations";
    payload: unknown;
};

/**
 * defaultContext(): 从 active flow 读取并拼装当前 Object 的 context 切片。
 *
 * 子原型可 override 加自己的切片。
 */
export async function defaultContext(ctx: ObjectContext): Promise<DefaultContextSlice[]> {
    const slices: DefaultContextSlice[] = [];
    const flowPath = ctx.record.paths.flow;
    if (!flowPath) {
        // 无 active flow → 只返回 relations (从 stone 推导)
        slices.push({ kind: "relations", payload: computeRelations(ctx) });
        return slices;
    }

    // 1. active plan
    const planPath = path.join(flowPath, "plan.md");
    const planContent = await readIfExists(planPath);
    if (planContent && planContent.trim().length > 0) {
        slices.push({ kind: "plan", payload: planContent });
    }

    // 2. unfinished todos
    const todosPath = path.join(flowPath, "todos.json");
    const todosBody = await readIfExists(todosPath);
    if (todosBody) {
        try {
            const parsed = JSON.parse(todosBody) as { items?: Array<{ id: string; content: string; checked: boolean }> };
            const unfinished = (parsed.items ?? []).filter((it) => !it.checked);
            if (unfinished.length > 0) {
                slices.push({ kind: "todos", payload: unfinished });
            }
        } catch {
            // 静默跳过损坏 JSON；不污染 context
        }
    }

    // 3. active threads (= flow/threads/<id>/ 内 thread.json 存在且 status != closed)
    const threadsRoot = path.join(flowPath, "threads");
    const active: string[] = [];
    if (await directoryExists(threadsRoot)) {
        const ids = await listSubdirs(threadsRoot);
        for (const id of ids) {
            const threadJson = path.join(threadsRoot, id, "thread.json");
            const tBody = await readIfExists(threadJson);
            if (tBody) {
                try {
                    const t = JSON.parse(tBody) as { status?: string };
                    if (t.status !== "closed") {
                        active.push(id);
                    }
                } catch {
                    // 损坏 thread.json 视为 active (保守)
                    active.push(id);
                }
            }
        }
    }
    if (active.length > 0) {
        slices.push({ kind: "threads", payload: active });
    }

    // 4. recent talks (= flow/talks/<peer>.jsonl 各取最后 N 条摘要)
    const talksRoot = path.join(flowPath, "talks");
    if (await directoryExists(talksRoot)) {
        const recent: Array<{ peer: string; lastLines: string[] }> = [];
        const peers = await fs.readdir(talksRoot);
        for (const peerFile of peers) {
            if (!peerFile.endsWith(".jsonl")) continue;
            const body = await readIfExists(path.join(talksRoot, peerFile));
            if (!body) continue;
            const lines = body.trim().split("\n").slice(-3); // 最后 3 条
            recent.push({
                peer: peerFile.replace(/\.jsonl$/, ""),
                lastLines: lines,
            });
        }
        if (recent.length > 0) {
            slices.push({ kind: "talks", payload: recent });
        }
    }

    // 5. relations (从 stone children/ + 同级扫描)
    slices.push({ kind: "relations", payload: computeRelations(ctx) });

    return slices;
}

function computeRelations(ctx: ObjectContext): { siblings: string[]; children: string[] } {
    const all = ctx.registry.list();
    const selfUri = ctx.record.uri;
    const selfStonePath = ctx.record.paths.stone;

    const children: string[] = [];
    if (selfStonePath) {
        const childrenPrefix = `${selfUri}/children/`;
        for (const r of all) {
            if (r.uri.startsWith(childrenPrefix)) {
                // 仅一层 child（不递归 grand-children）
                const tail = r.uri.slice(childrenPrefix.length);
                if (!tail.includes("/")) {
                    children.push(r.uri);
                }
            }
        }
    }

    const siblings: string[] = [];
    if (selfStonePath) {
        // siblings = 同 branch/<dir>/objects/ 下，与 self 同层但不同 name
        const selfStoneRel = selfStonePath; // 简化：把 stone path 当 key
        const parts = selfUri.split("/");
        // ooc://stones/<branch>/objects/<name>[/children/<...>] 取 parent prefix
        // 此处只处理顶层 sibling；children 内部不算 sibling
        if (parts.length >= 6 && parts[2] === "stones" && parts[4] === "objects" && parts.length === 6) {
            const parentPrefix = parts.slice(0, 5).join("/") + "/";
            for (const r of all) {
                if (r.uri !== selfUri && r.uri.startsWith(parentPrefix)) {
                    const tail = r.uri.slice(parentPrefix.length);
                    if (!tail.includes("/")) {
                        siblings.push(r.uri);
                    }
                }
            }
        }
    }

    return { siblings, children };
}

/* -------------------- public methods: skeletons (P5 fill in) -------------------- */

export default defineObject({
    public: {
        async talk(args: { target: string; content: string }, _ctx: ObjectContext) {
            // TODO P5: 实装 flow 层双端 talks/<peer>.jsonl append + 唤起 target LLM
            if (!args.target || !args.content) {
                throw new Error("talk: missing target or content");
            }
            return { ok: true, status: "skeleton", _todo: "P5 implements talk-直投回路" };
        },

        async do(args: { intent: string }, _ctx: ObjectContext) {
            // TODO P5: 实装 flow 层 threads/<id>/ 创建 + spawn sub-thread worker
            if (!args.intent) throw new Error("do: missing intent");
            return { ok: true, status: "skeleton", thread_id: "stub_" + String(Date.now()) };
        },

        async do_close(args: { thread_id: string }, _ctx: ObjectContext) {
            if (!args.thread_id) throw new Error("do_close: missing thread_id");
            return { ok: true, status: "skeleton" };
        },

        async todo_add(args: { content: string }, _ctx: ObjectContext) {
            if (!args.content) throw new Error("todo_add: missing content");
            return { ok: true, status: "skeleton", id: "stub_" + String(Date.now()) };
        },

        async todo_check(args: { id: string }, _ctx: ObjectContext) {
            if (!args.id) throw new Error("todo_check: missing id");
            return { ok: true, status: "skeleton" };
        },

        async todo_uncheck(args: { id: string }, _ctx: ObjectContext) {
            if (!args.id) throw new Error("todo_uncheck: missing id");
            return { ok: true, status: "skeleton" };
        },

        async todo_remove(args: { id: string }, _ctx: ObjectContext) {
            if (!args.id) throw new Error("todo_remove: missing id");
            return { ok: true, status: "skeleton" };
        },

        async todo_list(_args: Record<string, never>, _ctx: ObjectContext) {
            return { ok: true, status: "skeleton", items: [] as unknown[] };
        },

        async plan_set(args: { text: string }, _ctx: ObjectContext) {
            if (typeof args.text !== "string") throw new Error("plan_set: text required");
            return { ok: true, status: "skeleton" };
        },

        async plan_clear(_args: Record<string, never>, _ctx: ObjectContext) {
            return { ok: true, status: "skeleton" };
        },

        async grep(args: { pattern: string; path?: string }, _ctx: ObjectContext) {
            // TODO P6: 实装 ephemeral search Object 创建
            if (!args.pattern) throw new Error("grep: missing pattern");
            return { ok: true, status: "skeleton", _todo: "P6 implements ephemeral creation" };
        },

        async glob(args: { pattern: string }, _ctx: ObjectContext) {
            if (!args.pattern) throw new Error("glob: missing pattern");
            return { ok: true, status: "skeleton", _todo: "P6" };
        },

        async open_file(args: { path: string }, _ctx: ObjectContext) {
            if (!args.path) throw new Error("open_file: missing path");
            return { ok: true, status: "skeleton", _todo: "P6" };
        },

        async open_knowledge(args: { slug: string }, _ctx: ObjectContext) {
            if (!args.slug) throw new Error("open_knowledge: missing slug");
            return { ok: true, status: "skeleton", _todo: "P6" };
        },

        async metaprog(args: { intent: string }, _ctx: ObjectContext) {
            // TODO P8: 实装 super flow 协议
            if (!args.intent) throw new Error("metaprog: missing intent");
            return { ok: true, status: "skeleton", _todo: "P8 super flow" };
        },

        async write_file(args: { path: string; content: string }, _ctx: ObjectContext) {
            if (!args.path) throw new Error("write_file: missing path");
            if (typeof args.content !== "string") throw new Error("write_file: content required");
            return { ok: true, status: "skeleton", _todo: "P5/P8: bounded write" };
        },

        async end(_args: Record<string, never>, _ctx: ObjectContext) {
            return { ok: true, status: "skeleton" };
        },
    },
    private: {
        // 暂无私有方法；defaultContext 是导出函数，由 dispatcher 在拼装上下文时调用，不需要进 private map。
    },
});

/* -------------------- internal helpers -------------------- */

async function readIfExists(p: string): Promise<string | null> {
    try {
        return await fs.readFile(p, "utf8");
    } catch {
        return null;
    }
}

async function directoryExists(p: string): Promise<boolean> {
    try {
        const stat = await fs.stat(p);
        return stat.isDirectory();
    } catch {
        return false;
    }
}

async function listSubdirs(dir: string): Promise<string[]> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
}
```

- [ ] **Step 2: tsc 验证**

```bash
cd /Users/zhangzhefu/x/ooc-2/ooc-3-wt && bunx tsc --noEmit stones/_builtin/objects/root/server/index.ts
```

- [ ] **Step 3: Stage**

```bash
git add stones/_builtin/objects/root/server/
```

---

### Task 6: 写 stones/_builtin/objects/root/client/index.tsx (兜底 UI 占位)

**Files:**
- Create: `/Users/zhangzhefu/x/ooc-2/ooc-3-wt/stones/_builtin/objects/root/client/index.tsx`

P4 阶段：UI 占位组件，确认 tsc 通过；真实渲染在 P7 集成 AppShell 时实装。

- [ ] **Step 1: Write tsx**

```tsx
/**
 * stones/_builtin/objects/root/client/index.tsx
 *
 * OOC-3 根原型的自定义 UI 占位组件。任何 Object 渲染时，若自身无 client/index.tsx，
 * 沿 prototype 链 fallback 最终到这里（spec §5.2）。
 *
 * P4 阶段：组件 stub；真实 SSR + 路由集成在 P7（visible / web）。
 */

import * as React from "react";

export type RootObjectViewProps = {
    /** Object 的 ooc:// URI */
    uri: string;
    /** Object frontmatter (主要为 title / description / extends 等) */
    self: Record<string, unknown>;
    /** 由 defaultContext() 计算的 slices；由 host 注入 */
    slices?: Array<{ kind: string; payload: unknown }>;
    /** 是否只读（历史 flow / ephemeral session 结束后只读） */
    readOnly?: boolean;
};

/**
 * 默认 Object 视图：身份卡 + slices + (除非 readOnly) talk 输入框。
 *
 * 子原型通过 slot 组合扩展（P7 设计）。
 */
export default function RootObjectView(props: RootObjectViewProps): JSX.Element {
    const title =
        typeof props.self.title === "string" ? props.self.title : props.uri;

    return (
        <div className="ooc-object-view ooc-root-fallback">
            <header>
                <h2>{title}</h2>
                <code>{props.uri}</code>
            </header>
            <section className="ooc-slices">
                {(props.slices ?? []).map((s, i) => (
                    <div key={i} className={`ooc-slice ooc-slice-${s.kind}`}>
                        <h3>{s.kind}</h3>
                        <pre>{JSON.stringify(s.payload, null, 2)}</pre>
                    </div>
                ))}
            </section>
            {!props.readOnly ? (
                <footer>
                    {/* TODO P7: talk 输入框 + public method 直调按钮 */}
                    <em>talk input + method buttons (P7 placeholder)</em>
                </footer>
            ) : (
                <footer>
                    <em>read-only (history flow)</em>
                </footer>
            )}
        </div>
    );
}
```

- [ ] **Step 2: Verify tsc**

需要先安装 React 类型（如果还没）：

```bash
cd /Users/zhangzhefu/x/ooc-2/ooc-3-wt && bun pm ls 2>&1 | grep -i react
```

若 React 未安装：

```bash
cd /Users/zhangzhefu/x/ooc-2/ooc-3-wt && bun add react @types/react -d
```

然后 tsc：

```bash
cd /Users/zhangzhefu/x/ooc-2/ooc-3-wt && bunx tsc --noEmit stones/_builtin/objects/root/client/index.tsx 2>&1 | head -20
```

若 jsx 配置缺失，按提示在 tsconfig.json 加 `"jsx": "react-jsx"` 与 `"jsxImportSource": "react"`。

- [ ] **Step 3: Stage**

```bash
git add stones/_builtin/objects/root/client/
```

---

### Task 7: 写 stones/_builtin/objects/root/__tests__/default-context.test.ts

**Files:**
- Create: `/Users/zhangzhefu/x/ooc-2/ooc-3-wt/stones/_builtin/objects/root/__tests__/default-context.test.ts`

测试 defaultContext() 在不同 flow 状态下的拼装正确性。

- [ ] **Step 1: Write test**

```typescript
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { defaultContext } from "../server/index";
import { ObjectRegistry } from "@src/executable/registry";
import type { ObjectContext } from "@src/executable/server";
import type { ObjectRecord } from "@src/persistable/object-record";

async function write(p: string, body: string) {
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, body);
}

function makeCtx(world: string, sessionId: string, selfUri: string): ObjectContext {
    const registry = new ObjectRegistry();
    const self_record: ObjectRecord = {
        uri: selfUri,
        paths: {
            stone: path.join(world, "stones", "main", "objects", "agent_a"),
            pool: path.join(world, "pools", "objects", "agent_a"),
            flow: path.join(world, "flows", sessionId, "objects", "agent_a"),
        },
        kind: "persistent",
        self: { extends: "root" },
    };
    registry.set(self_record);
    return {
        record: self_record,
        worldRoot: world,
        sessionId,
        registry,
    };
}

describe("root.defaultContext()", () => {
    let world: string;

    beforeEach(async () => {
        world = await fs.mkdtemp(path.join(os.tmpdir(), "ooc-default-ctx-"));
    });

    afterEach(async () => {
        await fs.rm(world, { recursive: true, force: true });
    });

    test("空 flow + 空 stone → 仅 relations 切片 (siblings/children 空)", async () => {
        const ctx = makeCtx(world, "s_test", "ooc://stones/main/objects/agent_a");
        const slices = await defaultContext(ctx);
        expect(slices).toHaveLength(1);
        expect(slices[0].kind).toBe("relations");
        const rel = slices[0].payload as { siblings: string[]; children: string[] };
        expect(rel.siblings).toEqual([]);
        expect(rel.children).toEqual([]);
    });

    test("active plan 非空 → plan 切片", async () => {
        const ctx = makeCtx(world, "s_test", "ooc://stones/main/objects/agent_a");
        await write(path.join(ctx.record.paths.flow!, "plan.md"), "我的当前 plan");
        const slices = await defaultContext(ctx);
        const plan = slices.find((s) => s.kind === "plan");
        expect(plan).toBeDefined();
        expect(plan!.payload).toBe("我的当前 plan");
    });

    test("unfinished todos → todos 切片只列 unchecked", async () => {
        const ctx = makeCtx(world, "s_test", "ooc://stones/main/objects/agent_a");
        await write(
            path.join(ctx.record.paths.flow!, "todos.json"),
            JSON.stringify({
                items: [
                    { id: "t1", content: "done thing", checked: true },
                    { id: "t2", content: "pending thing", checked: false },
                ],
            }),
        );
        const slices = await defaultContext(ctx);
        const todos = slices.find((s) => s.kind === "todos");
        expect(todos).toBeDefined();
        const items = todos!.payload as Array<{ id: string }>;
        expect(items).toHaveLength(1);
        expect(items[0].id).toBe("t2");
    });

    test("active threads (open) appears; closed 不appears", async () => {
        const ctx = makeCtx(world, "s_test", "ooc://stones/main/objects/agent_a");
        await write(
            path.join(ctx.record.paths.flow!, "threads", "t_open", "thread.json"),
            JSON.stringify({ status: "active" }),
        );
        await write(
            path.join(ctx.record.paths.flow!, "threads", "t_done", "thread.json"),
            JSON.stringify({ status: "closed" }),
        );
        const slices = await defaultContext(ctx);
        const threads = slices.find((s) => s.kind === "threads");
        expect(threads).toBeDefined();
        const active = threads!.payload as string[];
        expect(active).toEqual(["t_open"]);
    });

    test("recent talks per peer", async () => {
        const ctx = makeCtx(world, "s_test", "ooc://stones/main/objects/agent_a");
        await write(
            path.join(ctx.record.paths.flow!, "talks", "agent_b.jsonl"),
            ['{"direction":"out","content":"hi"}', '{"direction":"in","content":"hello"}'].join("\n"),
        );
        const slices = await defaultContext(ctx);
        const talks = slices.find((s) => s.kind === "talks");
        expect(talks).toBeDefined();
        const arr = talks!.payload as Array<{ peer: string; lastLines: string[] }>;
        expect(arr).toHaveLength(1);
        expect(arr[0].peer).toBe("agent_b");
        expect(arr[0].lastLines).toHaveLength(2);
    });

    test("relations: siblings 与 children 来自 registry", async () => {
        const ctx = makeCtx(world, "s_test", "ooc://stones/main/objects/agent_a");
        // 加同级 sibling
        ctx.registry.set({
            uri: "ooc://stones/main/objects/agent_b",
            paths: { stone: "/tmp/x" },
            kind: "persistent",
            self: {},
        });
        // 加 child
        ctx.registry.set({
            uri: "ooc://stones/main/objects/agent_a/children/sub_1",
            paths: { stone: "/tmp/y" },
            kind: "persistent",
            self: {},
        });
        const slices = await defaultContext(ctx);
        const rel = slices.find((s) => s.kind === "relations");
        const r = rel!.payload as { siblings: string[]; children: string[] };
        expect(r.siblings).toContain("ooc://stones/main/objects/agent_b");
        expect(r.children).toContain("ooc://stones/main/objects/agent_a/children/sub_1");
    });

    test("无 flow path → 仅 relations 切片", async () => {
        const ctx: ObjectContext = {
            record: {
                uri: "ooc://stones/main/objects/x",
                paths: { stone: "/tmp" },
                kind: "persistent",
                self: {},
            },
            worldRoot: world,
            registry: new ObjectRegistry(),
        };
        const slices = await defaultContext(ctx);
        expect(slices).toHaveLength(1);
        expect(slices[0].kind).toBe("relations");
    });
});
```

- [ ] **Step 2: 跑测试**

```bash
cd /Users/zhangzhefu/x/ooc-2/ooc-3-wt && bun test stones/_builtin/objects/root/__tests__/default-context.test.ts
```
Expected: 7 tests pass。

- [ ] **Step 3: Stage**

```bash
git add stones/_builtin/objects/root/__tests__/
```

---

### Task 8: P4 gate + commit

- [ ] **Step 1: 全员 tsc + bun test**

```bash
cd /Users/zhangzhefu/x/ooc-2/ooc-3-wt && bunx tsc --noEmit
cd /Users/zhangzhefu/x/ooc-2/ooc-3-wt && bun test 2>&1 | tail -20
```
P4 gate: 全员 tsc 0 errors; bun test 总 PASS = 158 (P3) + 3 (server) + 3 (loader-with-server) + 7 (default-context) = **171 PASS**。

- [ ] **Step 2: git status**

```bash
cd /Users/zhangzhefu/x/ooc-2/ooc-3-wt && git status --short
```

- [ ] **Step 3: P4 commit**

```bash
cd /Users/zhangzhefu/x/ooc-2/ooc-3-wt && git commit -m "$(cat <<'EOF'
feat(p4): root builtin prototype + defaultContext

P4 阶段：在 ooc-3 worktree 落 root builtin prototype 与 loader 动态
import server module 的能力。

- src/executable/server.ts: ServerMethod / ServerMap / defineObject 助手
  + MethodNotFound / MethodNotPublic 错误类型
- src/executable/loader.ts: 扩展为动态 import server/index.ts；填充
  ObjectRecord.serverPublic / serverPrivate
- src/persistable/object-record.ts: 加可选 serverPublic / serverPrivate
- stones/_builtin/objects/root/:
  · self.md / readme.md: 身份与对外说明
  · server/index.ts: 13 个 public method skeleton (talk / do / todo_* /
    plan_* / grep / glob / open_file / open_knowledge / metaprog /
    write_file / end + do_close) + defaultContext() 真实实装
  · client/index.tsx: 兜底 UI 占位 (P7 在 web 集成时连线)
- tests: server.test.ts (3) + loader-with-server.test.ts (3) +
  default-context.test.ts (7) = 13 new tests

P4 gate: tsc 0 errors; bun test 全员 PASS。
B 类塌缩字段 method body (P5) + ephemeral 创建 (P6) + web (P7) 后续阶段。

Generated with [Claude Code](https://claude.ai/code)
via [Happy](https://happy.engineering)

Co-Authored-By: Claude <noreply@anthropic.com>
Co-Authored-By: Happy <yesreply@happy.engineering>
EOF
)"
```

- [ ] **Step 4: Verify**

```bash
cd /Users/zhangzhefu/x/ooc-2/ooc-3-wt && git log --oneline
cd /Users/zhangzhefu/x/ooc-2/ooc-3-wt && ls stones/_builtin/objects/root/
```

Expected: 7 commits on ooc-3；root 目录含 self.md/readme.md/server/client/__tests__。

P4 完成。
