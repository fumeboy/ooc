# OOC-3 P5 Implementation Plan: B 类塌缩字段 method body 实装

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** 把 P4 的 root 原型 method skeleton 替换为真实 flow 层写入实装：talks/、threads/、todos.json、plan.md 全部按 spec §2.4 与 §3 端到端落盘；talk 直投回路 + auto flow 创建 + sub-thread spawn 扁平 + 共享 owner 身份。配合 dispatcher 让 method 可被 cross-Object 调用。

**Architecture:** 在 src/persistable/ 加 flow-paths.ts (auto-create flow dirs + 计算 jsonl 路径)；在 src/executable/ 加 dispatcher.ts (按 prototype 链 resolve method 并调用)。然后 rewrite stones/_builtin/objects/root/server/index.ts 把 11 个 B 类 method body 替换为真实实装。配合单元测试 + 集成回路测试验证。

**Tech Stack:** TypeScript (bun), bun:test, fs/promises (append-only jsonl ops + JSON mutate)。

**Reference docs:**
- spec V2: `docs/superpowers/specs/2026-05-28-ooc-object-unification-design.md` §3.2-§3.5
- meta concept: `meta/object.doc.ts:patches.b_class_collapse`
- existing: P4 root prototype skeleton + loader + registry + prototype-resolver

**Out of scope:**
- 真实 LLM thinkloop（worker queue 与 LLM 调用）—— P6
- HTTP / CLI 触发入口 —— P6
- A 类 ephemeral Object 创建 (grep/program/etc) —— P6 (重命名后)
- web AppShell —— P7
- super flow 升格 —— P8

P5 完成后：可以从代码侧端到端调 talk/do/todo/plan 方法并看到 flow 目录正确生成；但 worker / LLM 还未唤起，所以"接收方"的 thread 不会真跑。

---

## File Structure

```
ooc-3-wt/
├── src/
│   ├── persistable/
│   │   ├── flow-paths.ts                       # 新写：flow 路径计算 + auto-create
│   │   └── __tests__/flow-paths.test.ts
│   ├── executable/
│   │   ├── dispatcher.ts                       # 新写：method 查找 + 调用
│   │   └── __tests__/dispatcher.test.ts
└── stones/
    └── _builtin/objects/root/
        ├── server/index.ts                     # 修改：B 类 method body 实装 (替换 skeleton)
        └── __tests__/
            ├── talk-method.test.ts             # 新写
            ├── do-method.test.ts               # 新写
            ├── todo-methods.test.ts            # 新写
            └── plan-methods.test.ts            # 新写
```

**Responsibilities:**
- `flow-paths.ts`: 给定 worldRoot + sessionId + Object name → 计算 flow dir + talks/<peer>.jsonl + threads/<id>/ 路径；auto-mkdir
- `dispatcher.ts`: 实现统一调用入口 invokeMethod(registry, targetUri, methodName, args, ctx) - 沿 prototype 链 resolve serverPublic[methodName]，调用 body
- root server methods (revised): talk/do/do_close/todo_*/plan_* 全部从 skeleton 升级为真实实装；其余 (grep/glob/open_*/metaprog/write_file/end) 仍 skeleton (P6/P8)

---

### Task 1: 写 src/persistable/flow-paths.ts

**Files:**
- Create: `/Users/zhangzhefu/x/ooc-2/ooc-3-wt/src/persistable/flow-paths.ts`

flow 路径计算 + auto-mkdir 工具。所有 B 类 method 通过它定位写入位置。

- [ ] **Step 1: Write file**

```typescript
/**
 * flow-paths: 一次 session 内 Object 的 flow 层路径计算与 auto-create。
 *
 * 详见 spec §2.1 (persistent Object flow 层结构) + §3.2-§3.5 (B 类字段路径)。
 */

import { promises as fs } from "node:fs";
import * as path from "node:path";

/**
 * 计算 Object 在指定 session 内的 flow 目录路径。
 *
 * 例:
 * - flowObjectDir("/world", "s_abc", "agent_a") → /world/flows/s_abc/objects/agent_a
 *
 * 不 mkdir；纯字符串。
 */
export function flowObjectDir(
    worldRoot: string,
    sessionId: string,
    objectName: string,
): string {
    return path.join(worldRoot, "flows", sessionId, "objects", objectName);
}

/**
 * 从 ooc:// URI 抽取 Object 的 "name"（最后一段或 children/<name> 的尾段）。
 *
 * 用于 persistent Object: ooc://stones/main/objects/foo → "foo"
 * 用于 persistent child:  ooc://stones/main/objects/foo/children/bar → "bar"（仅取末尾）
 * 用于 ephemeral:         ooc://flows/<s>/objects/search_xy → "search_xy"
 */
export function nameFromUri(uri: string): string {
    const segments = uri.split("/").filter((s) => s.length > 0);
    return segments[segments.length - 1];
}

/**
 * 确保 Object 在指定 session 的 flow 目录存在；返回该目录绝对路径。
 *
 * persistent Object 在 session 内被 talk 到时由此函数 lazy 创建 flow 目录。
 */
export async function ensureFlowDir(
    worldRoot: string,
    sessionId: string,
    objectName: string,
): Promise<string> {
    const dir = flowObjectDir(worldRoot, sessionId, objectName);
    await fs.mkdir(dir, { recursive: true });
    return dir;
}

/* -------------------- talks/<peer>.jsonl -------------------- */

/**
 * 把 peer URI 转为安全的 slug 用作文件名。
 *
 * 简化策略: 去除 ooc:// 前缀后把 "/" 替换为 "__"。
 * 必须保证可逆 (后续 UI 渲染需要)。
 */
export function peerSlugFromUri(peerUri: string): string {
    return peerUri.replace(/^ooc:\/\//, "").replace(/\//g, "__");
}

/**
 * 逆操作: slug → peer URI（用于 UI 加载）。
 */
export function peerUriFromSlug(slug: string): string {
    return "ooc://" + slug.replace(/__/g, "/");
}

export function talksDir(
    worldRoot: string,
    sessionId: string,
    objectName: string,
): string {
    return path.join(flowObjectDir(worldRoot, sessionId, objectName), "talks");
}

export function talksFile(
    worldRoot: string,
    sessionId: string,
    objectName: string,
    peerUri: string,
): string {
    return path.join(
        talksDir(worldRoot, sessionId, objectName),
        peerSlugFromUri(peerUri) + ".jsonl",
    );
}

export async function ensureTalksDir(
    worldRoot: string,
    sessionId: string,
    objectName: string,
): Promise<string> {
    const dir = talksDir(worldRoot, sessionId, objectName);
    await fs.mkdir(dir, { recursive: true });
    return dir;
}

/**
 * 单条 talk 消息记录。
 */
export type TalkEntry = {
    ts: string;                  // ISO timestamp
    direction: "in" | "out";
    peer: string;                // 对端 ooc:// URI
    content: string;
};

/**
 * append 一条 talk entry 到对应 jsonl 文件 (auto-create dir + file)。
 */
export async function appendTalkEntry(
    worldRoot: string,
    sessionId: string,
    objectName: string,
    entry: TalkEntry,
): Promise<void> {
    await ensureTalksDir(worldRoot, sessionId, objectName);
    const f = talksFile(worldRoot, sessionId, objectName, entry.peer);
    await fs.appendFile(f, JSON.stringify(entry) + "\n");
}

/* -------------------- threads/<id>/ -------------------- */

export function threadsDir(
    worldRoot: string,
    sessionId: string,
    objectName: string,
): string {
    return path.join(flowObjectDir(worldRoot, sessionId, objectName), "threads");
}

export function threadDir(
    worldRoot: string,
    sessionId: string,
    objectName: string,
    threadId: string,
): string {
    return path.join(threadsDir(worldRoot, sessionId, objectName), threadId);
}

export async function ensureThreadDir(
    worldRoot: string,
    sessionId: string,
    objectName: string,
    threadId: string,
): Promise<string> {
    const dir = threadDir(worldRoot, sessionId, objectName, threadId);
    await fs.mkdir(dir, { recursive: true });
    return dir;
}

/* -------------------- todos.json / plan.md (Object 主 thread 字段) -------------------- */

export function todosFile(
    worldRoot: string,
    sessionId: string,
    objectName: string,
): string {
    return path.join(flowObjectDir(worldRoot, sessionId, objectName), "todos.json");
}

export function planFile(
    worldRoot: string,
    sessionId: string,
    objectName: string,
): string {
    return path.join(flowObjectDir(worldRoot, sessionId, objectName), "plan.md");
}

/* -------------------- generic helpers -------------------- */

/**
 * 生成简短随机 id 用于 thread / ephemeral object 命名。
 * 8 字符 hex。
 */
export function shortId(prefix?: string): string {
    const hex = Math.random().toString(16).slice(2, 10);
    return prefix ? `${prefix}_${hex}` : hex;
}
```

- [ ] **Step 2: Write test**

Create `/Users/zhangzhefu/x/ooc-2/ooc-3-wt/src/persistable/__tests__/flow-paths.test.ts`:

```typescript
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { promises as fs } from "node:fs";
import os from "node:os";
import * as path from "node:path";
import {
    appendTalkEntry,
    ensureFlowDir,
    ensureTalksDir,
    flowObjectDir,
    nameFromUri,
    peerSlugFromUri,
    peerUriFromSlug,
    planFile,
    shortId,
    talksFile,
    threadDir,
    todosFile,
} from "../flow-paths";

describe("flow-paths", () => {
    let world: string;
    beforeEach(async () => {
        world = await fs.mkdtemp(path.join(os.tmpdir(), "ooc-flow-paths-"));
    });
    afterEach(async () => {
        await fs.rm(world, { recursive: true, force: true });
    });

    test("flowObjectDir 拼对", () => {
        expect(flowObjectDir("/w", "s_abc", "agent_a")).toBe(
            path.join("/w", "flows", "s_abc", "objects", "agent_a"),
        );
    });

    test("nameFromUri 处理顶层 / child / ephemeral", () => {
        expect(nameFromUri("ooc://stones/main/objects/foo")).toBe("foo");
        expect(nameFromUri("ooc://stones/main/objects/foo/children/bar")).toBe("bar");
        expect(nameFromUri("ooc://flows/s/objects/search_xy")).toBe("search_xy");
    });

    test("peerSlug 可逆", () => {
        const uri = "ooc://stones/main/objects/agent_b";
        const slug = peerSlugFromUri(uri);
        expect(peerUriFromSlug(slug)).toBe(uri);
        // 不含 "/" (URL-safe)
        expect(slug.includes("/")).toBe(false);
    });

    test("ensureFlowDir 创建目录", async () => {
        const dir = await ensureFlowDir(world, "s1", "obj1");
        const stat = await fs.stat(dir);
        expect(stat.isDirectory()).toBe(true);
    });

    test("ensureTalksDir 创建 talks 子目录", async () => {
        const dir = await ensureTalksDir(world, "s1", "obj1");
        expect(dir).toBe(path.join(world, "flows", "s1", "objects", "obj1", "talks"));
        const stat = await fs.stat(dir);
        expect(stat.isDirectory()).toBe(true);
    });

    test("appendTalkEntry append 一行到正确文件", async () => {
        await appendTalkEntry(world, "s1", "agent_a", {
            ts: "2026-05-28T00:00:00Z",
            direction: "out",
            peer: "ooc://stones/main/objects/agent_b",
            content: "hello",
        });
        const f = talksFile(world, "s1", "agent_a", "ooc://stones/main/objects/agent_b");
        const body = await fs.readFile(f, "utf8");
        const lines = body.trim().split("\n");
        expect(lines).toHaveLength(1);
        const parsed = JSON.parse(lines[0]);
        expect(parsed.direction).toBe("out");
        expect(parsed.content).toBe("hello");
    });

    test("appendTalkEntry 累积 append", async () => {
        for (let i = 0; i < 3; i++) {
            await appendTalkEntry(world, "s1", "agent_a", {
                ts: "2026-05-28T00:00:0" + i + "Z",
                direction: i % 2 === 0 ? "out" : "in",
                peer: "ooc://stones/main/objects/agent_b",
                content: "msg " + i,
            });
        }
        const f = talksFile(world, "s1", "agent_a", "ooc://stones/main/objects/agent_b");
        const lines = (await fs.readFile(f, "utf8")).trim().split("\n");
        expect(lines).toHaveLength(3);
    });

    test("threadDir 路径正确", () => {
        const d = threadDir("/w", "s1", "obj1", "t_xy");
        expect(d).toBe(path.join("/w", "flows", "s1", "objects", "obj1", "threads", "t_xy"));
    });

    test("todosFile / planFile 路径正确", () => {
        expect(todosFile("/w", "s1", "obj1")).toBe(
            path.join("/w", "flows", "s1", "objects", "obj1", "todos.json"),
        );
        expect(planFile("/w", "s1", "obj1")).toBe(
            path.join("/w", "flows", "s1", "objects", "obj1", "plan.md"),
        );
    });

    test("shortId 8 字符 hex", () => {
        const id = shortId();
        expect(id).toMatch(/^[0-9a-f]{8}$/);
    });

    test("shortId with prefix", () => {
        const id = shortId("t");
        expect(id).toMatch(/^t_[0-9a-f]{8}$/);
    });
});
```

- [ ] **Step 3: tsc + bun test**

```bash
cd /Users/zhangzhefu/x/ooc-2/ooc-3-wt && bunx tsc --noEmit src/persistable/flow-paths.ts src/persistable/__tests__/flow-paths.test.ts
cd /Users/zhangzhefu/x/ooc-2/ooc-3-wt && bun test src/persistable/__tests__/flow-paths.test.ts
```
Expected: 11 tests pass.

- [ ] **Step 4: Stage**

```bash
git add src/persistable/flow-paths.ts src/persistable/__tests__/flow-paths.test.ts
```

---

### Task 2: 写 src/executable/dispatcher.ts

**Files:**
- Create: `/Users/zhangzhefu/x/ooc-2/ooc-3-wt/src/executable/dispatcher.ts`
- Create test: `/Users/zhangzhefu/x/ooc-2/ooc-3-wt/src/executable/__tests__/dispatcher.test.ts`

实现统一 method 调用入口 `invokeMethod`：按 URI 查 record，沿 prototype 链找 serverPublic[name]，调用 body 并返回结果。

- [ ] **Step 1: Write dispatcher.ts**

```typescript
/**
 * Dispatcher: method 调用统一入口。
 *
 * 按 ObjectRecord URI 查 record，沿 prototype 链找对应 method body，调用并返回结果。
 *
 * 详见 spec §3.1。
 */

import type { ObjectContext, ServerMethod } from "./server";
import { MethodNotFoundError, MethodNotPublicError } from "./server";
import type { ObjectRegistry } from "./registry";
import { findInChain, resolveChain } from "./prototype-resolver";

/**
 * 调用 targetUri 上的 public method。
 *
 * - 找 method body: 沿 extends 链查 serverPublic[methodName]，找到第一个就用
 * - 若 method body 被 private map 持有但 public 没有 → MethodNotPublicError
 * - 都找不到 → MethodNotFoundError
 *
 * @param registry Object 注册表
 * @param targetUri 被调对象 URI
 * @param methodName 方法名
 * @param args 方法 args
 * @param baseCtx 调用上下文（除 record 外其他字段需提供）
 */
export async function invokeMethod(
    registry: ObjectRegistry,
    targetUri: string,
    methodName: string,
    args: unknown,
    baseCtx: Omit<ObjectContext, "record">,
): Promise<unknown> {
    const targetRecord = registry.get(targetUri);
    if (!targetRecord) {
        throw new Error(`Object not registered: ${targetUri}`);
    }

    // 先在链上找 public method
    const ownerUri = findInChain(registry, targetUri, (r) =>
        Boolean(r.serverPublic && methodName in r.serverPublic),
    );

    if (!ownerUri) {
        // 检查是否是 private 方法 (沿链查 serverPrivate)
        const privateOwner = findInChain(registry, targetUri, (r) =>
            Boolean(r.serverPrivate && methodName in r.serverPrivate),
        );
        if (privateOwner) {
            throw new MethodNotPublicError(methodName, targetUri);
        }
        throw new MethodNotFoundError(methodName, targetUri);
    }

    const ownerRecord = registry.get(ownerUri)!;
    const method = ownerRecord.serverPublic![methodName] as ServerMethod;
    const ctx: ObjectContext = {
        ...baseCtx,
        record: targetRecord,    // 注意: ctx.record 是被调对象（target），不是 method 的拥有者(prototype 祖先)
    };
    return await method(args, ctx);
}

/**
 * 调用 target Object 自身的 private method（仅同 Object server 内部 + sub-thread 共享 owner 身份场景）。
 *
 * 严格：private 不沿链查；只在 targetUri 自身的 serverPrivate 找。
 */
export async function invokePrivateMethod(
    registry: ObjectRegistry,
    targetUri: string,
    methodName: string,
    args: unknown,
    baseCtx: Omit<ObjectContext, "record">,
): Promise<unknown> {
    const record = registry.get(targetUri);
    if (!record) {
        throw new Error(`Object not registered: ${targetUri}`);
    }
    const priv = record.serverPrivate;
    if (!priv || !(methodName in priv)) {
        throw new MethodNotFoundError(methodName, targetUri);
    }
    const method = priv[methodName] as ServerMethod;
    const ctx: ObjectContext = { ...baseCtx, record };
    return await method(args, ctx);
}

/**
 * 返回 target Object 在 prototype 链上可见的所有 public method 名（去重，链顺序保留先于祖先）。
 * 用于 LLM context surface 渲染。
 */
export function listPublicMethods(
    registry: ObjectRegistry,
    targetUri: string,
): string[] {
    const chain = resolveChain(registry, targetUri);
    const seen = new Set<string>();
    const names: string[] = [];
    for (const uri of chain) {
        const record = registry.get(uri);
        if (!record?.serverPublic) continue;
        for (const name of Object.keys(record.serverPublic)) {
            if (!seen.has(name)) {
                seen.add(name);
                names.push(name);
            }
        }
    }
    return names;
}
```

- [ ] **Step 2: Write test**

Create `/Users/zhangzhefu/x/ooc-2/ooc-3-wt/src/executable/__tests__/dispatcher.test.ts`:

```typescript
import { describe, expect, test } from "bun:test";
import type { ObjectRecord } from "@src/persistable/object-record";
import { ObjectRegistry } from "../registry";
import {
    invokeMethod,
    invokePrivateMethod,
    listPublicMethods,
} from "../dispatcher";
import { MethodNotFoundError, MethodNotPublicError } from "../server";

function makeRegistry(): ObjectRegistry {
    const reg = new ObjectRegistry();

    // root prototype with talk/help
    const rootRec: ObjectRecord = {
        uri: "ooc://stones/_builtin/objects/root",
        paths: { stone: "/builtin/root" },
        kind: "builtin",
        self: {},
        serverPublic: {
            async talk(args: any) {
                return { ok: true, said: args.content };
            },
            async help() {
                return "root help";
            },
        },
        serverPrivate: {
            async _internal() {
                return "internal";
            },
        },
    };
    reg.set(rootRec);

    // a child object that extends root but overrides talk + adds own method
    const childRec: ObjectRecord = {
        uri: "ooc://stones/main/objects/agent_a",
        paths: { stone: "/main/agent_a" },
        kind: "persistent",
        self: { extends: "root" },
        serverPublic: {
            async talk(args: any) {
                return { ok: true, said: "child:" + args.content };
            },
            async bespoke() {
                return "I am agent_a";
            },
        },
    };
    reg.set(childRec);

    return reg;
}

const baseCtx = {
    worldRoot: "/tmp/world",
    sessionId: "s_test",
    registry: undefined as any,  // 由测试在调用前 set
};

describe("dispatcher.invokeMethod", () => {
    test("调自身 override → 自身 body 跑", async () => {
        const reg = makeRegistry();
        const ctx = { ...baseCtx, registry: reg };
        const result = (await invokeMethod(
            reg,
            "ooc://stones/main/objects/agent_a",
            "talk",
            { content: "hi" },
            ctx,
        )) as any;
        expect(result.said).toBe("child:hi");
    });

    test("调祖先 method (help) → 沿链到 root", async () => {
        const reg = makeRegistry();
        const ctx = { ...baseCtx, registry: reg };
        const result = await invokeMethod(
            reg,
            "ooc://stones/main/objects/agent_a",
            "help",
            {},
            ctx,
        );
        expect(result).toBe("root help");
    });

    test("调自身独有 method", async () => {
        const reg = makeRegistry();
        const ctx = { ...baseCtx, registry: reg };
        const result = await invokeMethod(
            reg,
            "ooc://stones/main/objects/agent_a",
            "bespoke",
            {},
            ctx,
        );
        expect(result).toBe("I am agent_a");
    });

    test("MethodNotFoundError 当方法链上都没有", async () => {
        const reg = makeRegistry();
        const ctx = { ...baseCtx, registry: reg };
        await expect(
            invokeMethod(reg, "ooc://stones/main/objects/agent_a", "missing", {}, ctx),
        ).rejects.toThrow(MethodNotFoundError);
    });

    test("MethodNotPublicError 当方法只在 private 上存在", async () => {
        const reg = makeRegistry();
        const ctx = { ...baseCtx, registry: reg };
        await expect(
            invokeMethod(
                reg,
                "ooc://stones/main/objects/agent_a",
                "_internal",
                {},
                ctx,
            ),
        ).rejects.toThrow(MethodNotPublicError);
    });

    test("Object not registered → 抛错", async () => {
        const reg = makeRegistry();
        const ctx = { ...baseCtx, registry: reg };
        await expect(
            invokeMethod(reg, "ooc://stones/main/objects/missing", "talk", {}, ctx),
        ).rejects.toThrow(/not registered/);
    });

    test("ctx.record 是 target 不是 prototype owner", async () => {
        const reg = makeRegistry();
        // 加一个 method 用于探测 ctx.record
        reg.get("ooc://stones/_builtin/objects/root")!.serverPublic!.whoami =
            async (_args: any, ctx2: any) => ctx2.record.uri;
        const ctx = { ...baseCtx, registry: reg };
        const result = await invokeMethod(
            reg,
            "ooc://stones/main/objects/agent_a",
            "whoami",
            {},
            ctx,
        );
        expect(result).toBe("ooc://stones/main/objects/agent_a");
    });
});

describe("dispatcher.invokePrivateMethod", () => {
    test("调自身 private method", async () => {
        const reg = makeRegistry();
        const ctx = { ...baseCtx, registry: reg };
        const result = await invokePrivateMethod(
            reg,
            "ooc://stones/_builtin/objects/root",
            "_internal",
            {},
            ctx,
        );
        expect(result).toBe("internal");
    });

    test("private 不沿链查 → 子类调祖先 private 抛错", async () => {
        const reg = makeRegistry();
        const ctx = { ...baseCtx, registry: reg };
        await expect(
            invokePrivateMethod(
                reg,
                "ooc://stones/main/objects/agent_a",
                "_internal",
                {},
                ctx,
            ),
        ).rejects.toThrow(MethodNotFoundError);
    });
});

describe("dispatcher.listPublicMethods", () => {
    test("合并自身 + 链上所有 public method，子类先于祖先", () => {
        const reg = makeRegistry();
        const names = listPublicMethods(reg, "ooc://stones/main/objects/agent_a");
        // 期望: talk (child覆盖 → 子类先), bespoke (子类独有), help (祖先唯一)
        expect(names).toEqual(["talk", "bespoke", "help"]);
    });

    test("root 自身只暴露 root 的 public", () => {
        const reg = makeRegistry();
        const names = listPublicMethods(reg, "ooc://stones/_builtin/objects/root");
        expect(names.sort()).toEqual(["help", "talk"]);
    });
});
```

- [ ] **Step 3: tsc + bun test**

```bash
cd /Users/zhangzhefu/x/ooc-2/ooc-3-wt && bunx tsc --noEmit src/executable/dispatcher.ts src/executable/__tests__/dispatcher.test.ts
cd /Users/zhangzhefu/x/ooc-2/ooc-3-wt && bun test src/executable/__tests__/dispatcher.test.ts
```
Expected: 11 tests pass.

- [ ] **Step 4: Stage**

```bash
git add src/executable/dispatcher.ts src/executable/__tests__/dispatcher.test.ts
```

---

### Task 3: Rewrite stones/_builtin/objects/root/server/index.ts B 类 method bodies

**Files:**
- Modify: `/Users/zhangzhefu/x/ooc-2/ooc-3-wt/stones/_builtin/objects/root/server/index.ts`

把 11 个 B 类 method (talk/do/do_close/todo_*/plan_*) 从 skeleton 替换为真实 flow 层写入。其余 (grep/glob/open_file/open_knowledge/metaprog/write_file/end) 保留 skeleton 不变。

- [ ] **Step 1: Read current root server file**

```bash
cd /Users/zhangzhefu/x/ooc-2/ooc-3-wt && wc -l stones/_builtin/objects/root/server/index.ts
```

- [ ] **Step 2: Edit B-class method bodies**

Use Edit tool. For EACH of the 11 methods, replace its skeleton body with a real implementation. Use `flow-paths.ts` helpers and `nameFromUri(ctx.record.uri)` to compute paths.

**talk method real body:**

```typescript
async talk(args: any, ctx: ObjectContext) {
    if (!args || typeof args.target !== "string" || typeof args.content !== "string") {
        throw new Error("talk: args.target (string) and args.content (string) required");
    }
    if (!ctx.sessionId) {
        throw new Error("talk: no active sessionId");
    }
    const { appendTalkEntry, nameFromUri } = await import("@src/persistable/flow-paths");
    const ts = new Date().toISOString();
    const selfName = nameFromUri(ctx.record.uri);
    const targetName = nameFromUri(args.target);

    // 1. self 端 → talks/<target>.jsonl direction=out
    await appendTalkEntry(ctx.worldRoot, ctx.sessionId, selfName, {
        ts,
        direction: "out",
        peer: args.target,
        content: args.content,
    });

    // 2. target 端 → talks/<self>.jsonl direction=in (auto-create flow dir for target)
    await appendTalkEntry(ctx.worldRoot, ctx.sessionId, targetName, {
        ts,
        direction: "in",
        peer: ctx.record.uri,
        content: args.content,
    });

    // TODO P6: schedule target's worker to wake
    return { ok: true, ts };
},
```

**do method real body:**

```typescript
async do(args: any, ctx: ObjectContext) {
    if (!args || typeof args.intent !== "string") {
        throw new Error("do: args.intent (string) required");
    }
    if (!ctx.sessionId) {
        throw new Error("do: no active sessionId");
    }
    const { ensureThreadDir, nameFromUri, shortId } = await import("@src/persistable/flow-paths");
    const fs = await import("node:fs/promises");
    const path = await import("node:path");

    const selfName = nameFromUri(ctx.record.uri);
    const threadId = shortId("t");
    const dir = await ensureThreadDir(ctx.worldRoot, ctx.sessionId, selfName, threadId);
    const intent: any = { intent: args.intent };
    if (typeof args.parent_thread_id === "string") {
        intent.parent_thread_id = args.parent_thread_id;
    }
    await fs.writeFile(
        path.join(dir, "intent.md"),
        `---\n${Object.entries(intent).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join("\n")}\n---\n\n${args.intent}\n`,
    );
    await fs.writeFile(
        path.join(dir, "thread.json"),
        JSON.stringify({ id: threadId, status: "active", created_at: new Date().toISOString() }, null, 2),
    );
    return { ok: true, thread_id: threadId };
},

async do_close(args: any, ctx: ObjectContext) {
    if (!args || typeof args.thread_id !== "string") {
        throw new Error("do_close: args.thread_id required");
    }
    if (!ctx.sessionId) throw new Error("do_close: no active sessionId");
    const { threadDir, nameFromUri } = await import("@src/persistable/flow-paths");
    const fs = await import("node:fs/promises");
    const path = await import("node:path");

    const selfName = nameFromUri(ctx.record.uri);
    const dir = threadDir(ctx.worldRoot, ctx.sessionId, selfName, args.thread_id);
    const jsonPath = path.join(dir, "thread.json");
    try {
        const body = await fs.readFile(jsonPath, "utf8");
        const obj = JSON.parse(body);
        obj.status = "closed";
        obj.closed_at = new Date().toISOString();
        await fs.writeFile(jsonPath, JSON.stringify(obj, null, 2));
    } catch (err) {
        throw new Error(`do_close: thread not found or invalid: ${args.thread_id}`);
    }
    return { ok: true };
},
```

**todo_* methods real bodies:**

```typescript
async todo_add(args: any, ctx: ObjectContext) {
    if (!args || typeof args.content !== "string") {
        throw new Error("todo_add: args.content required");
    }
    if (!ctx.sessionId) throw new Error("todo_add: no active sessionId");
    const { ensureFlowDir, nameFromUri, shortId, todosFile } = await import("@src/persistable/flow-paths");
    const fs = await import("node:fs/promises");

    const selfName = nameFromUri(ctx.record.uri);
    await ensureFlowDir(ctx.worldRoot, ctx.sessionId, selfName);
    const f = todosFile(ctx.worldRoot, ctx.sessionId, selfName);
    let data: { items: any[] } = { items: [] };
    try {
        const body = await fs.readFile(f, "utf8");
        data = JSON.parse(body);
        if (!Array.isArray(data.items)) data.items = [];
    } catch { /* file 不存在或损坏 → 初始化 */ }
    const id = shortId("td");
    data.items.push({ id, content: args.content, checked: false, created_at: new Date().toISOString() });
    await fs.writeFile(f, JSON.stringify(data, null, 2));
    return { ok: true, id };
},

async todo_check(args: any, ctx: ObjectContext) {
    if (!args || typeof args.id !== "string") throw new Error("todo_check: args.id required");
    return await _mutateTodoChecked(ctx, args.id, true);
},

async todo_uncheck(args: any, ctx: ObjectContext) {
    if (!args || typeof args.id !== "string") throw new Error("todo_uncheck: args.id required");
    return await _mutateTodoChecked(ctx, args.id, false);
},

async todo_remove(args: any, ctx: ObjectContext) {
    if (!args || typeof args.id !== "string") throw new Error("todo_remove: args.id required");
    if (!ctx.sessionId) throw new Error("todo_remove: no active sessionId");
    const { ensureFlowDir, nameFromUri, todosFile } = await import("@src/persistable/flow-paths");
    const fs = await import("node:fs/promises");
    const selfName = nameFromUri(ctx.record.uri);
    await ensureFlowDir(ctx.worldRoot, ctx.sessionId, selfName);
    const f = todosFile(ctx.worldRoot, ctx.sessionId, selfName);
    let data: { items: any[] } = { items: [] };
    try {
        data = JSON.parse(await fs.readFile(f, "utf8"));
        if (!Array.isArray(data.items)) data.items = [];
    } catch { return { ok: false, error: "no todos.json" }; }
    const before = data.items.length;
    data.items = data.items.filter((it: any) => it.id !== args.id);
    await fs.writeFile(f, JSON.stringify(data, null, 2));
    return { ok: data.items.length < before };
},

async todo_list(_args: any, ctx: ObjectContext) {
    if (!ctx.sessionId) throw new Error("todo_list: no active sessionId");
    const { nameFromUri, todosFile } = await import("@src/persistable/flow-paths");
    const fs = await import("node:fs/promises");
    const selfName = nameFromUri(ctx.record.uri);
    const f = todosFile(ctx.worldRoot, ctx.sessionId, selfName);
    try {
        const body = await fs.readFile(f, "utf8");
        const data = JSON.parse(body);
        return { ok: true, items: data.items ?? [] };
    } catch {
        return { ok: true, items: [] };
    }
},
```

You also need to add a private helper `_mutateTodoChecked` to the private map:

```typescript
private: {
    async _mutateTodoChecked(_args: any, _ctx: ObjectContext) {
        // direct-call only; actual logic below as a regular function
        throw new Error("_mutateTodoChecked: call via shared function only");
    },
},
```

And define the helper as a regular function (NOT in the map):

```typescript
async function _mutateTodoChecked(
    ctx: ObjectContext,
    id: string,
    checked: boolean,
): Promise<{ ok: boolean }> {
    if (!ctx.sessionId) throw new Error("todo: no active sessionId");
    const { ensureFlowDir, nameFromUri, todosFile } = await import("@src/persistable/flow-paths");
    const fs = await import("node:fs/promises");
    const selfName = nameFromUri(ctx.record.uri);
    await ensureFlowDir(ctx.worldRoot, ctx.sessionId, selfName);
    const f = todosFile(ctx.worldRoot, ctx.sessionId, selfName);
    let data: { items: any[] } = { items: [] };
    try {
        data = JSON.parse(await fs.readFile(f, "utf8"));
        if (!Array.isArray(data.items)) data.items = [];
    } catch { return { ok: false }; }
    let found = false;
    for (const it of data.items) {
        if (it.id === id) {
            it.checked = checked;
            it.updated_at = new Date().toISOString();
            found = true;
        }
    }
    await fs.writeFile(f, JSON.stringify(data, null, 2));
    return { ok: found };
}
```

> 注：`_mutateTodoChecked` 作为模块内 helper 函数，不进 server map（不暴露给外部调用），但 todo_check / todo_uncheck 通过模块作用域访问它。

**plan_* methods:**

```typescript
async plan_set(args: any, ctx: ObjectContext) {
    if (typeof args?.text !== "string") throw new Error("plan_set: args.text required");
    if (!ctx.sessionId) throw new Error("plan_set: no active sessionId");
    const { ensureFlowDir, nameFromUri, planFile } = await import("@src/persistable/flow-paths");
    const fs = await import("node:fs/promises");
    const selfName = nameFromUri(ctx.record.uri);
    await ensureFlowDir(ctx.worldRoot, ctx.sessionId, selfName);
    await fs.writeFile(planFile(ctx.worldRoot, ctx.sessionId, selfName), args.text);
    return { ok: true };
},

async plan_clear(_args: any, ctx: ObjectContext) {
    if (!ctx.sessionId) throw new Error("plan_clear: no active sessionId");
    const { nameFromUri, planFile } = await import("@src/persistable/flow-paths");
    const fs = await import("node:fs/promises");
    const selfName = nameFromUri(ctx.record.uri);
    try {
        await fs.unlink(planFile(ctx.worldRoot, ctx.sessionId, selfName));
    } catch { /* no plan → ok */ }
    return { ok: true };
},
```

> 提示：所有 `await import(...)` 内联在每个方法里是为了避免循环依赖；模块级也可以在文件顶部 static import flow-paths 中需要的函数。如果是 static 写法更好。但 Edit 工具的便利性视情况而定。

> **Better suggestion**: 把 `import { appendTalkEntry, ensureFlowDir, ensureThreadDir, nameFromUri, peerSlugFromUri, planFile, shortId, threadDir, todosFile } from "@src/persistable/flow-paths";` 放在文件顶部 import 处；method body 就可以直接调用。简化代码。

- [ ] **Step 3: tsc 验证**

```bash
cd /Users/zhangzhefu/x/ooc-2/ooc-3-wt && bunx tsc --noEmit stones/_builtin/objects/root/server/index.ts
```
Expected: 0 errors.

- [ ] **Step 4: Stage**

```bash
git add stones/_builtin/objects/root/server/index.ts
```

---

### Task 4: 写 root method 集成测试 (4 个新测试文件)

**Files:**
- Create: `/Users/zhangzhefu/x/ooc-2/ooc-3-wt/stones/_builtin/objects/root/__tests__/talk-method.test.ts`
- Create: `/Users/zhangzhefu/x/ooc-2/ooc-3-wt/stones/_builtin/objects/root/__tests__/do-method.test.ts`
- Create: `/Users/zhangzhefu/x/ooc-2/ooc-3-wt/stones/_builtin/objects/root/__tests__/todo-methods.test.ts`
- Create: `/Users/zhangzhefu/x/ooc-2/ooc-3-wt/stones/_builtin/objects/root/__tests__/plan-methods.test.ts`

每个测试文件按"创建 ctx + invoke 方法 + 断言 fs 写入"模式。

- [ ] **Step 1: 写 talk-method.test.ts**

```typescript
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { promises as fs } from "node:fs";
import os from "node:os";
import * as path from "node:path";
import rootServer from "../server/index";
import { ObjectRegistry } from "@src/executable/registry";
import { peerSlugFromUri } from "@src/persistable/flow-paths";
import type { ObjectRecord } from "@src/persistable/object-record";
import type { ObjectContext } from "@src/executable/server";

describe("root.talk", () => {
    let world: string;
    const sessionId = "s_talk_test";

    beforeEach(async () => {
        world = await fs.mkdtemp(path.join(os.tmpdir(), "ooc-talk-test-"));
    });

    afterEach(async () => {
        await fs.rm(world, { recursive: true, force: true });
    });

    function makeCtx(selfUri: string): ObjectContext {
        const reg = new ObjectRegistry();
        const rec: ObjectRecord = {
            uri: selfUri,
            paths: { stone: "/tmp" },
            kind: "persistent",
            self: { extends: "root" },
        };
        reg.set(rec);
        return { record: rec, worldRoot: world, sessionId, registry: reg };
    }

    test("talk 写入 self 端 out + target 端 in 两文件", async () => {
        const ctx = makeCtx("ooc://stones/main/objects/agent_a");
        const result = await rootServer.public.talk!(
            { target: "ooc://stones/main/objects/agent_b", content: "hi B" },
            ctx,
        ) as any;
        expect(result.ok).toBe(true);

        // self side: flows/<s>/objects/agent_a/talks/<slug-of-agent_b>.jsonl
        const selfFile = path.join(
            world, "flows", sessionId, "objects", "agent_a", "talks",
            peerSlugFromUri("ooc://stones/main/objects/agent_b") + ".jsonl",
        );
        const selfBody = await fs.readFile(selfFile, "utf8");
        expect(selfBody).toContain('"direction":"out"');
        expect(selfBody).toContain('"content":"hi B"');

        // target side: flows/<s>/objects/agent_b/talks/<slug-of-agent_a>.jsonl
        const targetFile = path.join(
            world, "flows", sessionId, "objects", "agent_b", "talks",
            peerSlugFromUri("ooc://stones/main/objects/agent_a") + ".jsonl",
        );
        const targetBody = await fs.readFile(targetFile, "utf8");
        expect(targetBody).toContain('"direction":"in"');
        expect(targetBody).toContain('"content":"hi B"');
    });

    test("missing target 抛错", async () => {
        const ctx = makeCtx("ooc://stones/main/objects/agent_a");
        await expect(
            rootServer.public.talk!({ content: "no target" } as any, ctx),
        ).rejects.toThrow(/target/);
    });

    test("missing sessionId 抛错", async () => {
        const ctx = makeCtx("ooc://stones/main/objects/agent_a");
        const ctx2: ObjectContext = { ...ctx, sessionId: undefined };
        await expect(
            rootServer.public.talk!(
                { target: "ooc://stones/main/objects/agent_b", content: "x" } as any,
                ctx2,
            ),
        ).rejects.toThrow(/sessionId/);
    });

    test("多次 talk 累积 append", async () => {
        const ctx = makeCtx("ooc://stones/main/objects/agent_a");
        for (let i = 0; i < 3; i++) {
            await rootServer.public.talk!(
                { target: "ooc://stones/main/objects/agent_b", content: "msg " + i } as any,
                ctx,
            );
        }
        const selfFile = path.join(
            world, "flows", sessionId, "objects", "agent_a", "talks",
            peerSlugFromUri("ooc://stones/main/objects/agent_b") + ".jsonl",
        );
        const lines = (await fs.readFile(selfFile, "utf8")).trim().split("\n");
        expect(lines).toHaveLength(3);
    });
});
```

- [ ] **Step 2: 写 do-method.test.ts**

```typescript
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { promises as fs } from "node:fs";
import os from "node:os";
import * as path from "node:path";
import rootServer from "../server/index";
import { ObjectRegistry } from "@src/executable/registry";
import type { ObjectRecord } from "@src/persistable/object-record";
import type { ObjectContext } from "@src/executable/server";

describe("root.do + do_close", () => {
    let world: string;
    const sessionId = "s_do_test";

    beforeEach(async () => {
        world = await fs.mkdtemp(path.join(os.tmpdir(), "ooc-do-test-"));
    });
    afterEach(async () => {
        await fs.rm(world, { recursive: true, force: true });
    });

    function makeCtx(): ObjectContext {
        const reg = new ObjectRegistry();
        const rec: ObjectRecord = {
            uri: "ooc://stones/main/objects/agent_a",
            paths: { stone: "/tmp" },
            kind: "persistent",
            self: {},
        };
        reg.set(rec);
        return { record: rec, worldRoot: world, sessionId, registry: reg };
    }

    test("do 创建 threads/<id>/ 目录与 intent.md + thread.json", async () => {
        const ctx = makeCtx();
        const result = (await rootServer.public.do!(
            { intent: "搞清楚 X" } as any,
            ctx,
        )) as { ok: boolean; thread_id: string };
        expect(result.ok).toBe(true);
        expect(result.thread_id).toMatch(/^t_[0-9a-f]+/);
        const dir = path.join(world, "flows", sessionId, "objects", "agent_a", "threads", result.thread_id);
        const intent = await fs.readFile(path.join(dir, "intent.md"), "utf8");
        expect(intent).toContain("搞清楚 X");
        const thread = JSON.parse(await fs.readFile(path.join(dir, "thread.json"), "utf8"));
        expect(thread.status).toBe("active");
    });

    test("do with parent_thread_id 字段写入 intent.md", async () => {
        const ctx = makeCtx();
        const result = (await rootServer.public.do!(
            { intent: "嵌套", parent_thread_id: "t_parent" } as any,
            ctx,
        )) as { thread_id: string };
        const intent = await fs.readFile(
            path.join(world, "flows", sessionId, "objects", "agent_a", "threads", result.thread_id, "intent.md"),
            "utf8",
        );
        expect(intent).toContain("parent_thread_id");
        expect(intent).toContain("t_parent");
    });

    test("do_close 将 thread.json status 标 closed", async () => {
        const ctx = makeCtx();
        const created = (await rootServer.public.do!({ intent: "x" } as any, ctx)) as { thread_id: string };
        await rootServer.public.do_close!({ thread_id: created.thread_id } as any, ctx);
        const thread = JSON.parse(
            await fs.readFile(
                path.join(world, "flows", sessionId, "objects", "agent_a", "threads", created.thread_id, "thread.json"),
                "utf8",
            ),
        );
        expect(thread.status).toBe("closed");
        expect(thread.closed_at).toBeDefined();
    });

    test("do_close 对不存在 thread 抛错", async () => {
        const ctx = makeCtx();
        await expect(
            rootServer.public.do_close!({ thread_id: "t_missing" } as any, ctx),
        ).rejects.toThrow(/not found/);
    });

    test("do 多次 spawn 在 threads/ 同层（扁平）", async () => {
        const ctx = makeCtx();
        const r1 = (await rootServer.public.do!({ intent: "a" } as any, ctx)) as { thread_id: string };
        const r2 = (await rootServer.public.do!({ intent: "b" } as any, ctx)) as { thread_id: string };
        expect(r1.thread_id).not.toBe(r2.thread_id);
        const threadsRoot = path.join(world, "flows", sessionId, "objects", "agent_a", "threads");
        const entries = await fs.readdir(threadsRoot, { withFileTypes: true });
        const dirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);
        expect(dirs.sort()).toEqual([r1.thread_id, r2.thread_id].sort());
    });
});
```

- [ ] **Step 3: 写 todo-methods.test.ts**

```typescript
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { promises as fs } from "node:fs";
import os from "node:os";
import * as path from "node:path";
import rootServer from "../server/index";
import { ObjectRegistry } from "@src/executable/registry";
import type { ObjectRecord } from "@src/persistable/object-record";
import type { ObjectContext } from "@src/executable/server";

describe("root.todo_*", () => {
    let world: string;
    const sessionId = "s_todo";
    function makeCtx(): ObjectContext {
        const reg = new ObjectRegistry();
        const rec: ObjectRecord = {
            uri: "ooc://stones/main/objects/agent_a",
            paths: { stone: "/tmp" },
            kind: "persistent",
            self: {},
        };
        reg.set(rec);
        return { record: rec, worldRoot: world, sessionId, registry: reg };
    }

    beforeEach(async () => {
        world = await fs.mkdtemp(path.join(os.tmpdir(), "ooc-todo-test-"));
    });
    afterEach(async () => {
        await fs.rm(world, { recursive: true, force: true });
    });

    async function readTodos(): Promise<any[]> {
        try {
            const body = await fs.readFile(
                path.join(world, "flows", sessionId, "objects", "agent_a", "todos.json"),
                "utf8",
            );
            return JSON.parse(body).items;
        } catch { return []; }
    }

    test("todo_add 写入 todos.json", async () => {
        const ctx = makeCtx();
        const r = (await rootServer.public.todo_add!({ content: "Do thing" } as any, ctx)) as any;
        expect(r.ok).toBe(true);
        expect(r.id).toMatch(/^td_/);
        const items = await readTodos();
        expect(items).toHaveLength(1);
        expect(items[0].content).toBe("Do thing");
        expect(items[0].checked).toBe(false);
    });

    test("todo_check 标记 checked=true", async () => {
        const ctx = makeCtx();
        const r = (await rootServer.public.todo_add!({ content: "X" } as any, ctx)) as any;
        await rootServer.public.todo_check!({ id: r.id } as any, ctx);
        const items = await readTodos();
        expect(items[0].checked).toBe(true);
    });

    test("todo_uncheck 标记 checked=false", async () => {
        const ctx = makeCtx();
        const r = (await rootServer.public.todo_add!({ content: "X" } as any, ctx)) as any;
        await rootServer.public.todo_check!({ id: r.id } as any, ctx);
        await rootServer.public.todo_uncheck!({ id: r.id } as any, ctx);
        const items = await readTodos();
        expect(items[0].checked).toBe(false);
    });

    test("todo_remove 删除 item", async () => {
        const ctx = makeCtx();
        const r1 = (await rootServer.public.todo_add!({ content: "A" } as any, ctx)) as any;
        const r2 = (await rootServer.public.todo_add!({ content: "B" } as any, ctx)) as any;
        await rootServer.public.todo_remove!({ id: r1.id } as any, ctx);
        const items = await readTodos();
        expect(items).toHaveLength(1);
        expect(items[0].id).toBe(r2.id);
    });

    test("todo_list 返回所有 items", async () => {
        const ctx = makeCtx();
        await rootServer.public.todo_add!({ content: "A" } as any, ctx);
        await rootServer.public.todo_add!({ content: "B" } as any, ctx);
        const r = (await rootServer.public.todo_list!({} as any, ctx)) as any;
        expect(r.items).toHaveLength(2);
    });

    test("todo_list 空 → 空数组", async () => {
        const ctx = makeCtx();
        const r = (await rootServer.public.todo_list!({} as any, ctx)) as any;
        expect(r.items).toEqual([]);
    });
});
```

- [ ] **Step 4: 写 plan-methods.test.ts**

```typescript
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { promises as fs } from "node:fs";
import os from "node:os";
import * as path from "node:path";
import rootServer from "../server/index";
import { ObjectRegistry } from "@src/executable/registry";
import type { ObjectRecord } from "@src/persistable/object-record";
import type { ObjectContext } from "@src/executable/server";

describe("root.plan_*", () => {
    let world: string;
    const sessionId = "s_plan";

    function makeCtx(): ObjectContext {
        const reg = new ObjectRegistry();
        const rec: ObjectRecord = {
            uri: "ooc://stones/main/objects/agent_a",
            paths: { stone: "/tmp" },
            kind: "persistent",
            self: {},
        };
        reg.set(rec);
        return { record: rec, worldRoot: world, sessionId, registry: reg };
    }

    beforeEach(async () => {
        world = await fs.mkdtemp(path.join(os.tmpdir(), "ooc-plan-test-"));
    });
    afterEach(async () => {
        await fs.rm(world, { recursive: true, force: true });
    });

    test("plan_set 写入 plan.md", async () => {
        const ctx = makeCtx();
        await rootServer.public.plan_set!({ text: "My plan text" } as any, ctx);
        const body = await fs.readFile(
            path.join(world, "flows", sessionId, "objects", "agent_a", "plan.md"),
            "utf8",
        );
        expect(body).toBe("My plan text");
    });

    test("plan_set 覆盖之前内容", async () => {
        const ctx = makeCtx();
        await rootServer.public.plan_set!({ text: "v1" } as any, ctx);
        await rootServer.public.plan_set!({ text: "v2" } as any, ctx);
        const body = await fs.readFile(
            path.join(world, "flows", sessionId, "objects", "agent_a", "plan.md"),
            "utf8",
        );
        expect(body).toBe("v2");
    });

    test("plan_clear 删除 plan.md", async () => {
        const ctx = makeCtx();
        await rootServer.public.plan_set!({ text: "x" } as any, ctx);
        await rootServer.public.plan_clear!({} as any, ctx);
        await expect(
            fs.access(path.join(world, "flows", sessionId, "objects", "agent_a", "plan.md")),
        ).rejects.toThrow();
    });

    test("plan_clear 当没有 plan.md 也不抛错", async () => {
        const ctx = makeCtx();
        const r = (await rootServer.public.plan_clear!({} as any, ctx)) as any;
        expect(r.ok).toBe(true);
    });
});
```

- [ ] **Step 5: 跑全 4 个测试文件**

```bash
cd /Users/zhangzhefu/x/ooc-2/ooc-3-wt && bun test stones/_builtin/objects/root/__tests__/talk-method.test.ts
cd /Users/zhangzhefu/x/ooc-2/ooc-3-wt && bun test stones/_builtin/objects/root/__tests__/do-method.test.ts
cd /Users/zhangzhefu/x/ooc-2/ooc-3-wt && bun test stones/_builtin/objects/root/__tests__/todo-methods.test.ts
cd /Users/zhangzhefu/x/ooc-2/ooc-3-wt && bun test stones/_builtin/objects/root/__tests__/plan-methods.test.ts
```
Expected: 4 + 5 + 6 + 4 = 19 tests pass。

- [ ] **Step 6: Stage**

```bash
git add stones/_builtin/objects/root/__tests__/
```

---

### Task 5: P5 gate + commit

- [ ] **Step 1: 全员 tsc + bun test**

```bash
cd /Users/zhangzhefu/x/ooc-2/ooc-3-wt && bunx tsc --noEmit
cd /Users/zhangzhefu/x/ooc-2/ooc-3-wt && bun test 2>&1 | tail -10
```
P5 gate: 全员 tsc 0 errors；bun test PASS = 171 (P4 baseline) + 11 (flow-paths) + 11 (dispatcher) + 19 (root B-class methods) = **212 PASS**。

- [ ] **Step 2: Copy plan file 入 ooc-3 worktree**

```bash
cp /Users/zhangzhefu/x/ooc-2/ooc/docs/superpowers/plans/2026-05-28-ooc-3-p5-b-class-collapse.md \
   /Users/zhangzhefu/x/ooc-2/ooc-3-wt/docs/superpowers/plans/
cd /Users/zhangzhefu/x/ooc-2/ooc-3-wt && git add docs/superpowers/plans/
```

- [ ] **Step 3: P5 commit**

```bash
cd /Users/zhangzhefu/x/ooc-2/ooc-3-wt && git commit -m "$(cat <<'EOF'
feat(p5): B 类塌缩字段 method body 实装

P5 阶段：把 P4 root 原型 11 个 B 类 method skeleton 替换为真实 flow 层
写入实装；dispatcher 实现 method 调用统一入口；flow-paths 工具计算路径
auto-create。

- src/persistable/flow-paths.ts: 路径计算 + auto-mkdir + talks/threads/
  todos/plan/shortId/peerSlug 工具
- src/executable/dispatcher.ts: invokeMethod / invokePrivateMethod /
  listPublicMethods 沿 prototype 链 resolve method body 并调用
- stones/_builtin/objects/root/server/index.ts: 11 个 B 类 method 真实
  实装 (talk 双端 append；do 创建 threads/<id>/ ；do_close 标 closed；
  todo_*/plan_* 文件 mutate)；其余 6 个 method (grep/glob/open_*/
  metaprog/write_file/end) 仍 skeleton (P6+)

测试: 11 flow-paths + 11 dispatcher + 19 B-class method = 41 new tests。
P5 gate: 全员 tsc 0 errors + 212 bun test PASS。

P5 后状态: 可代码端到端调 B 类方法 + 看到 flow 目录正确生成；
但 worker / LLM thinkloop 还未 wire 所以 talk 不会真"唤起"对方 LLM。
真 e2e + LLM 集成是 P6 工作。

Generated with [Claude Code](https://claude.ai/code)
via [Happy](https://happy.engineering)

Co-Authored-By: Claude <noreply@anthropic.com>
Co-Authored-By: Happy <yesreply@happy.engineering>
EOF
)"
```

- [ ] **Step 4: 验证**

```bash
cd /Users/zhangzhefu/x/ooc-2/ooc-3-wt && git log --oneline
cd /Users/zhangzhefu/x/ooc-2/ooc-3-wt && wc -l src/persistable/flow-paths.ts src/executable/dispatcher.ts stones/_builtin/objects/root/server/index.ts
```

Expected: 8 commits on ooc-3 branch；working tree clean。

P5 完成。
