# OOC-3 P2+P3 Implementation Plan: persistable / thinkable 基础 + loader + prototype 链

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** 在 ooc-3 worktree 上落 P2 (运行时底座 copy from ooc-2 + 新 object-record / uri 类型) 与 P3 (新 loader + Object registry + prototype 链解析)。Gate = §4 单元测试全 PASS。

**Architecture:** copy 领域稳定的基础设施（LLM transport / observation / world-config / csv-pool / git 初始化等）；新写归一后的 ObjectRecord 三层 paths 类型 + ooc:// URI 解析 + loader 三层源扫描 + prototype 链 fallback resolver。所有新写代码遵循 spec V2 §4 描述。

**Tech Stack:** TypeScript (bun runtime), bun:test, fs/promises, path utils。

**Reference docs:**
- spec V2: `docs/superpowers/specs/2026-05-28-ooc-object-unification-design.md` §2 + §4
- meta concept skeleton: `meta/object.doc.ts`（Plan 1 已落）
- ooc-2 参考代码: `/Users/zhangzhefu/x/ooc-2/ooc/src/persistable/` 等

**Out of scope:**
- root prototype 内置 method（grep / talk / do 等）—— P4 任务
- B 类塌缩字段实装（talks/threads/todos/plan）—— P5 任务
- A 类 ephemeral 创建机制 —— P6 任务
- web/AppShell —— P7 任务

---

## File Structure

**Files to create or copy in ooc-3 worktree:**

```
ooc-3-wt/src/
├── persistable/                          # P2
│   ├── world-config.ts                   # copy from ooc-2
│   ├── common.ts                         # copy from ooc-2
│   ├── csv-pool.ts                       # copy from ooc-2（pool 基础设施）
│   ├── pool-object.ts                    # copy from ooc-2
│   ├── stone-bootstrap.ts                # copy from ooc-2（git 初始化）
│   ├── stone-git.ts                      # copy from ooc-2
│   ├── versioned-write.ts                # copy from ooc-2
│   ├── serial-queue.ts                   # copy from ooc-2（worker 串行 fs writes）
│   ├── debug-file.ts                     # copy from ooc-2
│   ├── object-record.ts                  # 新写：ObjectRecord 三层 paths 类型
│   ├── uri.ts                            # 新写：ooc:// URI parse/serialize
│   ├── index.ts                          # 新写：统一 export
│   └── __tests__/
│       ├── world-config.test.ts          # copy from ooc-2
│       ├── object-record.test.ts         # 新写
│       └── uri.test.ts                   # 新写
├── thinkable/llm/                        # P2 完整 copy
│   ├── client.ts
│   ├── env.ts
│   ├── index.ts
│   ├── timeout.ts
│   ├── types.ts
│   ├── providers/                        # claude.ts / claude-sse.ts / claude-transport.ts / openai.ts
│   └── __tests__/                        # 全部 copy（real-openai.test.ts 是 live LLM 测试可选 skip）
├── observable/                           # P2 完整 copy
│   ├── index.ts
│   ├── window-hash.ts
│   └── __tests__/
├── app/server/bootstrap/                 # P2 部分 copy
│   ├── config.ts                         # copy from ooc-2
│   ├── hash.ts                           # copy from ooc-2
│   ├── errors.ts                         # copy from ooc-2
│   └── __tests__/config.test.ts          # copy from ooc-2
└── executable/                           # P3
    ├── loader.ts                         # 新写：三层源扫描
    ├── registry.ts                       # 新写：ObjectRecord registry
    ├── prototype-resolver.ts             # 新写：extends 链解析
    └── __tests__/
        ├── loader.test.ts                # 新写
        ├── registry.test.ts              # 新写
        └── prototype-resolver.test.ts    # 新写
```

**File responsibility:**
- `world-config.ts`: 解析 `--world` 参数，计算 stones/pools/flows 路径
- `object-record.ts`: 定义 `ObjectRecord` 类型 with `paths: { stone?, pool?, flow? }`
- `uri.ts`: ooc:// URI ↔ filesystem path 双向解析
- `loader.ts`: 扫描三类源（builtin / branch / flow current）建注册表
- `registry.ts`: ObjectRecord 索引 + 查询
- `prototype-resolver.ts`: 实现 §4.2 算法（extends 链 + 循环检测）

---

### Task 1: Copy persistable 基础文件 + tests

**Files:**
- Copy from `/Users/zhangzhefu/x/ooc-2/ooc/src/persistable/`:
  - `world-config.ts`, `common.ts`, `csv-pool.ts`, `pool-object.ts`
  - `stone-bootstrap.ts`, `stone-git.ts`
  - `versioned-write.ts`, `serial-queue.ts`, `debug-file.ts`
- Copy tests:
  - `__tests__/world-config.test.ts`
  - `__tests__/csv-pool.test.ts`
  - `__tests__/pool-object.test.ts`
  - `__tests__/serial-queue.test.ts`
  - `__tests__/stone-bootstrap.test.ts`
  - `__tests__/stone-git.test.ts`

- [ ] **Step 1: 创建目录**

```bash
cd /Users/zhangzhefu/x/ooc-2/ooc-3-wt
mkdir -p src/persistable/__tests__
```

- [ ] **Step 2: 复制源文件**

```bash
cd /Users/zhangzhefu/x/ooc-2/ooc-3-wt
for f in world-config.ts common.ts csv-pool.ts pool-object.ts stone-bootstrap.ts stone-git.ts versioned-write.ts serial-queue.ts debug-file.ts; do
  cp /Users/zhangzhefu/x/ooc-2/ooc/src/persistable/$f src/persistable/
done
for f in world-config.test.ts csv-pool.test.ts pool-object.test.ts serial-queue.test.ts stone-bootstrap.test.ts stone-git.test.ts; do
  cp /Users/zhangzhefu/x/ooc-2/ooc/src/persistable/__tests__/$f src/persistable/__tests__/
done
```

- [ ] **Step 3: 跑 tsc 看看缺什么 import**

```bash
cd /Users/zhangzhefu/x/ooc-2/ooc-3-wt && bunx tsc --noEmit 2>&1 | head -40
```

Expected: 可能会有 import 报错指向被引用但未复制的文件。**记下错误**，决定是补充复制还是修改 import。

- [ ] **Step 4: 补充任何缺失依赖**

如果有 missing import，按需要复制依赖（比如 ooc-2 src/persistable/index.ts re-exports 等）。如果某 import 来自我们决定不要的文件（比如 stone-self.ts），需要修改源文件去掉这条 import 或留作 TODO（如不是核心路径）。

Strategy:
- import 来自这些文件 → 补充复制：[common.ts, world-config.ts, csv-pool.ts, pool-object.ts, stone-git.ts, stone-bootstrap.ts, versioned-write.ts, serial-queue.ts, debug-file.ts, thread-json.ts]
- import 来自 stone-self/stone-readme/stone-server/stone-client/stone-skills/stone-versioning/stone-object → 这些是旧 Window 模型辅助函数；本 plan 暂不复制；如果当前文件强依赖某个，记入 BLOCKED 报告

- [ ] **Step 5: 跑 bun test src/persistable/__tests__/**

```bash
cd /Users/zhangzhefu/x/ooc-2/ooc-3-wt && bun test src/persistable/__tests__/ 2>&1 | tail -30
```

Expected: 大部分测试 PASS；个别可能 fail 是 dependency missing 引起的。记录 PASS/FAIL 计数。

- [ ] **Step 6: 不 commit；等 Task 7 一并**

```bash
git add src/
```

---

### Task 2: Copy src/thinkable/llm/ 完整目录

**Files:**
- Copy entire `/Users/zhangzhefu/x/ooc-2/ooc/src/thinkable/llm/` directory

- [ ] **Step 1: 复制**

```bash
cd /Users/zhangzhefu/x/ooc-2/ooc-3-wt
mkdir -p src/thinkable/llm/providers src/thinkable/llm/__tests__
cp /Users/zhangzhefu/x/ooc-2/ooc/src/thinkable/llm/*.ts src/thinkable/llm/
cp /Users/zhangzhefu/x/ooc-2/ooc/src/thinkable/llm/providers/*.ts src/thinkable/llm/providers/
cp /Users/zhangzhefu/x/ooc-2/ooc/src/thinkable/llm/__tests__/*.ts src/thinkable/llm/__tests__/
```

- [ ] **Step 2: tsc 验证**

```bash
cd /Users/zhangzhefu/x/ooc-2/ooc-3-wt && bunx tsc --noEmit src/thinkable/llm/*.ts src/thinkable/llm/providers/*.ts 2>&1 | head -20
```

如果有 import error 指向不存在文件，记下问题（很可能 thinkable/llm 是自闭包的，无外部依赖）。

- [ ] **Step 3: 跑 LLM 单元测试（排除 real-openai live 测试）**

```bash
cd /Users/zhangzhefu/x/ooc-2/ooc-3-wt && bun test src/thinkable/llm/__tests__/ --test-name-pattern='^(?!.*real)' 2>&1 | tail -20
```

注：如果 bun test 不支持 negate pattern，跑全部 + 接受 real-openai 测试 fail（没 API key）：
```bash
bun test src/thinkable/llm/__tests__/ 2>&1 | tail -30
```

记 PASS/FAIL 计数。

- [ ] **Step 4: stage**

```bash
git add src/thinkable/
```

---

### Task 3: Copy src/observable/ + src/app/server/bootstrap/ 子集

**Files:**
- Copy entire `/Users/zhangzhefu/x/ooc-2/ooc/src/observable/`
- Copy from `/Users/zhangzhefu/x/ooc-2/ooc/src/app/server/bootstrap/`:
  - `config.ts`, `hash.ts`, `errors.ts`
  - `__tests__/config.test.ts`

- [ ] **Step 1: 复制 observable**

```bash
cd /Users/zhangzhefu/x/ooc-2/ooc-3-wt
mkdir -p src/observable/__tests__
cp /Users/zhangzhefu/x/ooc-2/ooc/src/observable/*.ts src/observable/
cp /Users/zhangzhefu/x/ooc-2/ooc/src/observable/__tests__/*.ts src/observable/__tests__/
```

- [ ] **Step 2: 复制 bootstrap 子集**

```bash
cd /Users/zhangzhefu/x/ooc-2/ooc-3-wt
mkdir -p src/app/server/bootstrap/__tests__
cp /Users/zhangzhefu/x/ooc-2/ooc/src/app/server/bootstrap/config.ts src/app/server/bootstrap/
cp /Users/zhangzhefu/x/ooc-2/ooc/src/app/server/bootstrap/hash.ts src/app/server/bootstrap/
cp /Users/zhangzhefu/x/ooc-2/ooc/src/app/server/bootstrap/errors.ts src/app/server/bootstrap/
cp /Users/zhangzhefu/x/ooc-2/ooc/src/app/server/bootstrap/__tests__/config.test.ts src/app/server/bootstrap/__tests__/
```

- [ ] **Step 3: tsc + bun test 验证**

```bash
cd /Users/zhangzhefu/x/ooc-2/ooc-3-wt && bunx tsc --noEmit src/observable/*.ts src/app/server/bootstrap/*.ts 2>&1 | head -20
cd /Users/zhangzhefu/x/ooc-2/ooc-3-wt && bun test src/observable/ src/app/server/bootstrap/__tests__/ 2>&1 | tail -20
```

记 PASS/FAIL；observation 是简单 hash logger，应该 self-contained。

- [ ] **Step 4: stage**

```bash
git add src/observable/ src/app/server/
```

---

### Task 4: 写 src/persistable/object-record.ts (新)

**Files:**
- Create: `/Users/zhangzhefu/x/ooc-2/ooc-3-wt/src/persistable/object-record.ts`

定义 ObjectRecord 类型与辅助函数（按 spec V2 §4.2）。

- [ ] **Step 1: 写新文件**

Create with content:

```typescript
/**
 * ObjectRecord: OOC Object 在 runtime 的统一表示，承载三层物理路径 (stone/pool/flow)
 * 与从 self.md frontmatter 解析出的元数据。
 *
 * 详见 spec §4.2。
 */

export type ObjectKind = "builtin" | "persistent" | "ephemeral";

/**
 * Object 在三层持久层中的实际磁盘路径（可能仅部分存在）。
 * - stone: 身份与设计；persistent / builtin 必有；ephemeral 没有
 * - pool: 累积产物；persistent 通常有；builtin / ephemeral 没有
 * - flow: 当前活跃 session 的运行时过程；persistent 在 active session 中有；ephemeral 是它的全部
 */
export type ObjectPaths = {
    stone?: string;
    pool?: string;
    flow?: string;
};

/**
 * self.md 的 frontmatter 解析结果。除 extends 外的字段允许任意 key-value。
 */
export type SelfFrontmatter = {
    extends?: string;
    [key: string]: unknown;
};

/**
 * Object 在 registry 中的完整记录。
 *
 * 由 loader 从磁盘 scan 时构造；prototype 链解析、URI 解析、method dispatch 都基于此。
 */
export type ObjectRecord = {
    /** ooc:// 绝对 URI */
    uri: string;
    /** 三层物理路径 */
    paths: ObjectPaths;
    /** 类别：决定加载策略与生命期 */
    kind: ObjectKind;
    /** self.md frontmatter */
    self: SelfFrontmatter;
};

/**
 * 判断 Object 是否为 builtin prototype（位置即类别）。
 */
export function isBuiltin(record: ObjectRecord): boolean {
    return record.kind === "builtin";
}

/**
 * 判断 Object 是否为 persistent（同时占 stone + pool）。
 */
export function isPersistent(record: ObjectRecord): boolean {
    return record.kind === "persistent";
}

/**
 * 判断 Object 是否为 ephemeral（仅在 flow 内）。
 */
export function isEphemeral(record: ObjectRecord): boolean {
    return record.kind === "ephemeral";
}
```

- [ ] **Step 2: tsc 验证**

```bash
cd /Users/zhangzhefu/x/ooc-2/ooc-3-wt && bunx tsc --noEmit src/persistable/object-record.ts
```
Expected: 0 errors.

- [ ] **Step 3: 写测试**

Create `/Users/zhangzhefu/x/ooc-2/ooc-3-wt/src/persistable/__tests__/object-record.test.ts`:

```typescript
import { describe, expect, test } from "bun:test";
import {
    type ObjectRecord,
    isBuiltin,
    isEphemeral,
    isPersistent,
} from "../object-record";

describe("ObjectRecord helpers", () => {
    test("isBuiltin returns true only for builtin kind", () => {
        const builtin: ObjectRecord = {
            uri: "ooc://stones/_builtin/objects/root",
            paths: { stone: "/tmp/stones/_builtin/objects/root" },
            kind: "builtin",
            self: {},
        };
        const persistent: ObjectRecord = {
            uri: "ooc://stones/main/objects/foo",
            paths: { stone: "/tmp/stones/main/objects/foo", pool: "/tmp/pools/objects/foo" },
            kind: "persistent",
            self: { extends: "root" },
        };
        expect(isBuiltin(builtin)).toBe(true);
        expect(isBuiltin(persistent)).toBe(false);
    });

    test("isPersistent + isEphemeral mutually exclusive with builtin", () => {
        const ephemeral: ObjectRecord = {
            uri: "ooc://flows/s_abc/objects/search_x1",
            paths: { flow: "/tmp/flows/s_abc/objects/search_x1" },
            kind: "ephemeral",
            self: { extends: "search" },
        };
        expect(isPersistent(ephemeral)).toBe(false);
        expect(isEphemeral(ephemeral)).toBe(true);
        expect(isBuiltin(ephemeral)).toBe(false);
    });
});
```

- [ ] **Step 4: 跑测试**

```bash
cd /Users/zhangzhefu/x/ooc-2/ooc-3-wt && bun test src/persistable/__tests__/object-record.test.ts
```
Expected: 2 tests pass.

- [ ] **Step 5: stage**

```bash
git add src/persistable/object-record.ts src/persistable/__tests__/object-record.test.ts
```

---

### Task 5: 写 src/persistable/uri.ts (新)

**Files:**
- Create: `/Users/zhangzhefu/x/ooc-2/ooc-3-wt/src/persistable/uri.ts`
- Create test: `/Users/zhangzhefu/x/ooc-2/ooc-3-wt/src/persistable/__tests__/uri.test.ts`

实现 `ooc://` URI 与文件系统路径的双向转换（按 spec V2 §4.3）。

- [ ] **Step 1: 写 uri.ts**

Create with content:

```typescript
/**
 * ooc:// URI scheme — 1:1 镜像文件系统路径。
 *
 * 形态（spec §4.3）:
 * - ooc://stones/_builtin/objects/<proto>
 * - ooc://stones/<branch>/objects/<name>
 * - ooc://stones/<branch>/objects/<name>/children/<sub>
 * - ooc://pools/objects/<name>
 * - ooc://pools/<shared>
 * - ooc://flows/<sessionId>/objects/<name>
 * - ooc://flows/<sessionId>/objects/<name>/threads/<thread_id>
 *
 * runtime 与 web 共用同一份解析器。
 */

import path from "node:path";

const URI_PREFIX = "ooc://";

/**
 * 解析出的 URI 三段：root（stones/pools/flows）+ 第一级（branch/sessionId/etc）+ 余下路径段。
 */
export type ParsedURI = {
    layer: "stones" | "pools" | "flows";
    /** stones 下第一段是 branch；flows 下是 sessionId；pools 下是 'objects' 或 '<shared-name>' */
    head: string;
    /** 余下路径段（按 "/" 切分） */
    rest: string[];
};

export function isOocURI(value: string): boolean {
    return value.startsWith(URI_PREFIX);
}

/**
 * 解析 ooc:// URI 为结构化对象。
 *
 * @throws 当 URI 不以 ooc:// 开头或 layer 无效时抛错（boundary input 严格检查）
 */
export function parseURI(uri: string): ParsedURI {
    if (!isOocURI(uri)) {
        throw new Error(`Not an ooc:// URI: ${uri}`);
    }
    const stripped = uri.slice(URI_PREFIX.length);
    const segments = stripped.split("/").filter((s) => s.length > 0);
    if (segments.length === 0) {
        throw new Error(`URI has no path: ${uri}`);
    }
    const layer = segments[0];
    if (layer !== "stones" && layer !== "pools" && layer !== "flows") {
        throw new Error(`Unknown layer "${layer}" in URI: ${uri}`);
    }
    if (segments.length < 2) {
        throw new Error(`URI has no head segment after layer: ${uri}`);
    }
    return {
        layer,
        head: segments[1],
        rest: segments.slice(2),
    };
}

/**
 * 把 ooc:// URI 转换为相对于 world root 的文件系统路径。
 *
 * 例: ooc://stones/main/objects/foo → stones/main/objects/foo
 *
 * 不做绝对路径拼接（由调用方决定 world root）；纯字符串变换。
 */
export function uriToRelativePath(uri: string): string {
    const parsed = parseURI(uri);
    return path.join(parsed.layer, parsed.head, ...parsed.rest);
}

/**
 * 把相对于 world root 的文件系统路径反向构造为 ooc:// URI。
 *
 * 例: stones/main/objects/foo → ooc://stones/main/objects/foo
 *
 * 输入必须以 stones/ 或 pools/ 或 flows/ 开头；否则抛错。
 */
export function relativePathToURI(relPath: string): string {
    const normalized = relPath.split(path.sep).join("/");
    const segments = normalized.split("/").filter((s) => s.length > 0);
    if (segments.length === 0) {
        throw new Error(`Empty path cannot be converted to URI`);
    }
    const layer = segments[0];
    if (layer !== "stones" && layer !== "pools" && layer !== "flows") {
        throw new Error(`Path does not start with stones/pools/flows: ${relPath}`);
    }
    return `${URI_PREFIX}${segments.join("/")}`;
}

/**
 * 解析 self.md 中 extends 字段的"简写"为完整 URI。
 *
 * - "root" / "search" / "program" 等命名 → ooc://stones/_builtin/objects/<name>
 * - 已经是完整 ooc:// URI → 原样返回
 *
 * 任何其他形态（含 "/"）→ 抛错（避免歧义）
 */
export function resolveExtendsURI(extendsField: string): string {
    if (isOocURI(extendsField)) {
        return extendsField;
    }
    if (extendsField.includes("/") || extendsField.includes(":")) {
        throw new Error(`extends shorthand must be a bare name, got: ${extendsField}`);
    }
    return `${URI_PREFIX}stones/_builtin/objects/${extendsField}`;
}
```

- [ ] **Step 2: tsc 验证**

```bash
cd /Users/zhangzhefu/x/ooc-2/ooc-3-wt && bunx tsc --noEmit src/persistable/uri.ts
```
Expected: 0 errors.

- [ ] **Step 3: 写测试**

Create `/Users/zhangzhefu/x/ooc-2/ooc-3-wt/src/persistable/__tests__/uri.test.ts`:

```typescript
import { describe, expect, test } from "bun:test";
import {
    isOocURI,
    parseURI,
    relativePathToURI,
    resolveExtendsURI,
    uriToRelativePath,
} from "../uri";

describe("ooc:// URI parser", () => {
    test("isOocURI true for ooc:// prefix", () => {
        expect(isOocURI("ooc://stones/main/objects/foo")).toBe(true);
        expect(isOocURI("https://example.com")).toBe(false);
        expect(isOocURI("stones/main/objects/foo")).toBe(false);
    });

    test("parseURI stones path", () => {
        const result = parseURI("ooc://stones/main/objects/foo");
        expect(result.layer).toBe("stones");
        expect(result.head).toBe("main");
        expect(result.rest).toEqual(["objects", "foo"]);
    });

    test("parseURI stones with children", () => {
        const result = parseURI("ooc://stones/main/objects/foo/children/bar");
        expect(result.layer).toBe("stones");
        expect(result.head).toBe("main");
        expect(result.rest).toEqual(["objects", "foo", "children", "bar"]);
    });

    test("parseURI builtin prototype", () => {
        const result = parseURI("ooc://stones/_builtin/objects/root");
        expect(result.layer).toBe("stones");
        expect(result.head).toBe("_builtin");
        expect(result.rest).toEqual(["objects", "root"]);
    });

    test("parseURI flows path", () => {
        const result = parseURI("ooc://flows/s_abc/objects/search_x1");
        expect(result.layer).toBe("flows");
        expect(result.head).toBe("s_abc");
        expect(result.rest).toEqual(["objects", "search_x1"]);
    });

    test("parseURI flows with thread", () => {
        const result = parseURI("ooc://flows/s_abc/objects/foo/threads/t_xy");
        expect(result.layer).toBe("flows");
        expect(result.head).toBe("s_abc");
        expect(result.rest).toEqual(["objects", "foo", "threads", "t_xy"]);
    });

    test("parseURI pools per-Object", () => {
        const result = parseURI("ooc://pools/objects/foo");
        expect(result.layer).toBe("pools");
        expect(result.head).toBe("objects");
        expect(result.rest).toEqual(["foo"]);
    });

    test("parseURI pools shared", () => {
        const result = parseURI("ooc://pools/git-repos/some-repo");
        expect(result.layer).toBe("pools");
        expect(result.head).toBe("git-repos");
        expect(result.rest).toEqual(["some-repo"]);
    });

    test("parseURI rejects non-ooc URI", () => {
        expect(() => parseURI("https://example.com")).toThrow();
    });

    test("parseURI rejects unknown layer", () => {
        expect(() => parseURI("ooc://wat/whatever")).toThrow();
    });

    test("uriToRelativePath strips prefix and joins", () => {
        expect(uriToRelativePath("ooc://stones/main/objects/foo")).toBe(
            "stones/main/objects/foo",
        );
        expect(uriToRelativePath("ooc://flows/s/objects/x")).toBe(
            "flows/s/objects/x",
        );
    });

    test("relativePathToURI inverts uriToRelativePath", () => {
        const uri = "ooc://stones/main/objects/foo/children/bar";
        expect(relativePathToURI(uriToRelativePath(uri))).toBe(uri);
    });

    test("relativePathToURI rejects path outside three layers", () => {
        expect(() => relativePathToURI("src/foo/bar")).toThrow();
    });

    test("resolveExtendsURI expands bare name to builtin URI", () => {
        expect(resolveExtendsURI("search")).toBe(
            "ooc://stones/_builtin/objects/search",
        );
        expect(resolveExtendsURI("root")).toBe(
            "ooc://stones/_builtin/objects/root",
        );
    });

    test("resolveExtendsURI passes through full URI", () => {
        const full = "ooc://stones/main/objects/parent_obj";
        expect(resolveExtendsURI(full)).toBe(full);
    });

    test("resolveExtendsURI rejects shorthand with slash", () => {
        expect(() => resolveExtendsURI("foo/bar")).toThrow();
    });
});
```

- [ ] **Step 4: 跑测试**

```bash
cd /Users/zhangzhefu/x/ooc-2/ooc-3-wt && bun test src/persistable/__tests__/uri.test.ts
```
Expected: 14 tests pass.

- [ ] **Step 5: stage**

```bash
git add src/persistable/uri.ts src/persistable/__tests__/uri.test.ts
```

---

### Task 6: 写 src/persistable/index.ts (统一 export)

**Files:**
- Create: `/Users/zhangzhefu/x/ooc-2/ooc-3-wt/src/persistable/index.ts`

- [ ] **Step 1: 写 index**

Create:

```typescript
/**
 * src/persistable — Object 三层持久化的统一 export 入口。
 *
 * 详见 meta/object.doc.ts:persistable 子树 + spec §2.
 */

export * from "./object-record";
export * from "./uri";
export * from "./world-config";

// 内部辅助模块按需选择性 re-export；调用方可直接从子模块 import
// (csv-pool / pool-object / stone-bootstrap / stone-git / versioned-write /
//  serial-queue / debug-file / common 等)
```

- [ ] **Step 2: tsc**

```bash
cd /Users/zhangzhefu/x/ooc-2/ooc-3-wt && bunx tsc --noEmit src/persistable/index.ts
```

- [ ] **Step 3: stage**

```bash
git add src/persistable/index.ts
```

---

### Task 7: P2 commit

**Files:**
- Modify (stage existing): commit 当前 staged 状态

- [ ] **Step 1: 全员 tsc 验证**

```bash
cd /Users/zhangzhefu/x/ooc-2/ooc-3-wt && bunx tsc --noEmit 2>&1 | tail -20
```
Expected: exit 0；若有 errors，**报告但不修复**——错误应来自 P2 的 ooc-2 copy 中存留的旧概念依赖；按 task 1 step 4 strategy 处理。

- [ ] **Step 2: 全员 bun test**

```bash
cd /Users/zhangzhefu/x/ooc-2/ooc-3-wt && bun test 2>&1 | tail -20
```
记 PASS/FAIL 数。多数应 PASS（基础设施 self-contained）。

- [ ] **Step 3: git status**

```bash
cd /Users/zhangzhefu/x/ooc-2/ooc-3-wt && git status --short | head -30
```
应看到所有 src/persistable/*, src/thinkable/llm/*, src/observable/*, src/app/server/bootstrap/* 文件 staged。

- [ ] **Step 4: P2 commit**

```bash
cd /Users/zhangzhefu/x/ooc-2/ooc-3-wt && git commit -m "$(cat <<'EOF'
feat(p2): persistable / thinkable / observable foundation

P2 阶段：copy 领域稳定的基础设施 from ooc-2 + 新写归一后的 ObjectRecord
与 ooc:// URI 解析器。

Copied:
- src/persistable/{world-config, common, csv-pool, pool-object,
  stone-bootstrap, stone-git, versioned-write, serial-queue, debug-file}
- src/thinkable/llm/* (含 providers/ 与 __tests__/)
- src/observable/*
- src/app/server/bootstrap/{config, hash, errors}

新写:
- src/persistable/object-record.ts (ObjectRecord 三层 paths 类型)
- src/persistable/uri.ts (ooc:// URI parse/serialize/resolve-extends)
- src/persistable/index.ts (统一 export 入口)

测试: 新模块全 PASS；copy 模块测试 PASS 数详见 commit 文末。

下一 task (P3): 新 loader + registry + prototype 链解析。

Generated with [Claude Code](https://claude.ai/code)
via [Happy](https://happy.engineering)

Co-Authored-By: Claude <noreply@anthropic.com>
Co-Authored-By: Happy <yesreply@happy.engineering>
EOF
)"
```

- [ ] **Step 5: 验证 commit**

```bash
cd /Users/zhangzhefu/x/ooc-2/ooc-3-wt && git log --oneline
```

Expected: 看到 P2 commit + Plan 1 的 3 个 commit = 共 4 个。

---

### Task 8: 写 src/executable/loader.ts

**Files:**
- Create: `/Users/zhangzhefu/x/ooc-2/ooc-3-wt/src/executable/loader.ts`

实现 spec §4.1 三层源扫描 + self.md frontmatter 解析。

- [ ] **Step 1: mkdir**

```bash
cd /Users/zhangzhefu/x/ooc-2/ooc-3-wt && mkdir -p src/executable/__tests__
```

- [ ] **Step 2: 写 loader.ts**

Create with content:

```typescript
/**
 * Object loader: 扫描三层源（stone builtin/branch + pool per-Object + flow current）建 ObjectRecord 列表。
 *
 * 详见 spec §4.1。
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import {
    type ObjectRecord,
    type ObjectKind,
    type SelfFrontmatter,
} from "../persistable/object-record";
import { relativePathToURI } from "../persistable/uri";

/**
 * Loader 输入：world root 与可选的 active branch / sessionId。
 */
export type LoaderConfig = {
    /** world 根目录绝对路径（包含 stones/ pools/ flows/） */
    worldRoot: string;
    /** stone branch persistent 扫描根，如 "main"；省略不扫 branch persistent */
    branch?: string;
    /** 当前活跃 session id；省略不扫 flow */
    sessionId?: string;
};

/**
 * 扫描所有三层源并返回 ObjectRecord 列表。
 *
 * 顺序: builtin → branch persistent → flow ephemeral。
 * 由调用方负责将结果灌进 registry（不在 loader 中维持状态）。
 */
export async function loadObjects(config: LoaderConfig): Promise<ObjectRecord[]> {
    const records: ObjectRecord[] = [];

    // 1. builtin: stones/_builtin/objects/<proto>/
    const builtinDir = path.join(config.worldRoot, "stones", "_builtin", "objects");
    if (await directoryExists(builtinDir)) {
        const names = await listSubdirs(builtinDir);
        for (const name of names) {
            const stonePath = path.join(builtinDir, name);
            const self = await readSelfMd(stonePath);
            records.push({
                uri: `ooc://stones/_builtin/objects/${name}`,
                paths: { stone: stonePath },
                kind: "builtin",
                self,
            });
        }
    }

    // 2. branch persistent: stones/<branch>/objects/<name>/[children/<sub>/]*
    if (config.branch) {
        const branchObjectsDir = path.join(
            config.worldRoot,
            "stones",
            config.branch,
            "objects",
        );
        if (await directoryExists(branchObjectsDir)) {
            for await (const stonePath of walkObjectTree(branchObjectsDir)) {
                const relFromWorld = path.relative(config.worldRoot, stonePath);
                const self = await readSelfMd(stonePath);
                const uri = relativePathToURI(relFromWorld);
                const poolPath = poolPathFor(config.worldRoot, stonePath, branchObjectsDir);
                records.push({
                    uri,
                    paths: { stone: stonePath, pool: poolPath },
                    kind: "persistent",
                    self,
                });
            }
        }
    }

    // 3. flow current session: flows/<sessionId>/objects/<id>/
    if (config.sessionId) {
        const flowObjectsDir = path.join(
            config.worldRoot,
            "flows",
            config.sessionId,
            "objects",
        );
        if (await directoryExists(flowObjectsDir)) {
            const ids = await listSubdirs(flowObjectsDir);
            for (const id of ids) {
                const flowPath = path.join(flowObjectsDir, id);
                const self = await readSelfMd(flowPath);
                records.push({
                    uri: `ooc://flows/${config.sessionId}/objects/${id}`,
                    paths: { flow: flowPath },
                    kind: "ephemeral",
                    self,
                });
            }
        }
    }

    return records;
}

/* ---------------- internal helpers ---------------- */

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

/**
 * 在 branch persistent 树中递归遍历 Object 目录（顶层 + children/<sub>/+），
 * 仅 yield 含 self.md 的目录。
 */
async function* walkObjectTree(rootDir: string): AsyncGenerator<string> {
    const queue: string[] = await listSubdirs(rootDir).then((names) =>
        names.map((n) => path.join(rootDir, n)),
    );
    while (queue.length > 0) {
        const dir = queue.shift()!;
        const selfPath = path.join(dir, "self.md");
        if (await fileExists(selfPath)) {
            yield dir;
        }
        const childrenDir = path.join(dir, "children");
        if (await directoryExists(childrenDir)) {
            const subs = await listSubdirs(childrenDir);
            for (const sub of subs) {
                queue.push(path.join(childrenDir, sub));
            }
        }
    }
}

async function fileExists(p: string): Promise<boolean> {
    try {
        const stat = await fs.stat(p);
        return stat.isFile();
    } catch {
        return false;
    }
}

async function readSelfMd(objectDir: string): Promise<SelfFrontmatter> {
    const selfPath = path.join(objectDir, "self.md");
    let content: string;
    try {
        content = await fs.readFile(selfPath, "utf8");
    } catch {
        // 无 self.md 视为空 frontmatter（builtin / 占位目录场景）
        return {};
    }
    const fm = parseFrontmatter(content);
    return fm;
}

/**
 * 解析 markdown 文件顶部 --- yaml --- 块。无 frontmatter 时返回 {}。
 */
function parseFrontmatter(content: string): SelfFrontmatter {
    if (!content.startsWith("---")) {
        return {};
    }
    const end = content.indexOf("\n---", 3);
    if (end === -1) {
        return {};
    }
    const yamlBlock = content.slice(3, end).replace(/^\n/, "");
    const parsed = yaml.load(yamlBlock);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as SelfFrontmatter;
    }
    return {};
}

/**
 * 从 stone 路径推导 pool 路径。
 *
 * 例：
 * - stones/main/objects/foo → pools/objects/foo
 * - stones/main/objects/foo/children/bar → pools/objects/foo/children/bar （扁平复制）
 *
 * pool 不分 branch；branch 段在路径上被剥离。
 */
function poolPathFor(worldRoot: string, stonePath: string, branchObjectsDir: string): string {
    const relFromBranchObjects = path.relative(branchObjectsDir, stonePath);
    return path.join(worldRoot, "pools", "objects", relFromBranchObjects);
}
```

- [ ] **Step 3: 验证 js-yaml 安装**

```bash
cd /Users/zhangzhefu/x/ooc-2/ooc-3-wt && cat package.json | grep js-yaml
```
Expected: 看到 `"js-yaml": "^4.1.1"` 已经在 dependencies（ooc-2 copy 进来的）。

- [ ] **Step 4: tsc 验证**

```bash
cd /Users/zhangzhefu/x/ooc-2/ooc-3-wt && bunx tsc --noEmit src/executable/loader.ts
```
Expected: 0 errors。

- [ ] **Step 5: stage**

```bash
git add src/executable/loader.ts
```

---

### Task 9: 写 src/executable/loader.test.ts

**Files:**
- Create: `/Users/zhangzhefu/x/ooc-2/ooc-3-wt/src/executable/__tests__/loader.test.ts`

- [ ] **Step 1: 写测试（含 fs fixtures）**

Create:

```typescript
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { loadObjects } from "../loader";

describe("loader: 三层源扫描", () => {
    let world: string;

    beforeEach(async () => {
        world = await fs.mkdtemp(path.join(os.tmpdir(), "ooc-loader-test-"));
    });

    afterEach(async () => {
        await fs.rm(world, { recursive: true, force: true });
    });

    async function write(p: string, body: string) {
        await fs.mkdir(path.dirname(p), { recursive: true });
        await fs.writeFile(p, body);
    }

    test("空 world 返回空列表", async () => {
        const records = await loadObjects({ worldRoot: world });
        expect(records).toEqual([]);
    });

    test("builtin 扫描", async () => {
        await write(
            path.join(world, "stones", "_builtin", "objects", "root", "self.md"),
            "---\n# root prototype\n---\n# root\n",
        );
        await write(
            path.join(world, "stones", "_builtin", "objects", "search", "self.md"),
            "---\nextends: root\n---\n# search\n",
        );

        const records = await loadObjects({ worldRoot: world });
        expect(records).toHaveLength(2);
        const root = records.find((r) => r.uri.endsWith("/root"));
        const search = records.find((r) => r.uri.endsWith("/search"));
        expect(root).toBeDefined();
        expect(search).toBeDefined();
        expect(root!.kind).toBe("builtin");
        expect(search!.self.extends).toBe("root");
    });

    test("branch persistent 含 children 递归", async () => {
        await write(
            path.join(world, "stones", "main", "objects", "foo", "self.md"),
            "---\nextends: root\n---\n# foo\n",
        );
        await write(
            path.join(world, "stones", "main", "objects", "foo", "children", "bar", "self.md"),
            "---\n---\n# bar child\n",
        );

        const records = await loadObjects({ worldRoot: world, branch: "main" });
        expect(records).toHaveLength(2);
        const foo = records.find((r) => r.uri === "ooc://stones/main/objects/foo");
        const bar = records.find((r) =>
            r.uri === "ooc://stones/main/objects/foo/children/bar",
        );
        expect(foo).toBeDefined();
        expect(bar).toBeDefined();
        expect(foo!.kind).toBe("persistent");
        expect(foo!.paths.pool).toBe(path.join(world, "pools", "objects", "foo"));
        expect(bar!.paths.pool).toBe(
            path.join(world, "pools", "objects", "foo", "children", "bar"),
        );
    });

    test("flow ephemeral 扫描", async () => {
        await write(
            path.join(world, "flows", "s_abc", "objects", "search_x1", "self.md"),
            "---\nextends: search\nquery: foo\n---\n# search result\n",
        );

        const records = await loadObjects({ worldRoot: world, sessionId: "s_abc" });
        expect(records).toHaveLength(1);
        const r = records[0];
        expect(r.uri).toBe("ooc://flows/s_abc/objects/search_x1");
        expect(r.kind).toBe("ephemeral");
        expect(r.self.extends).toBe("search");
        expect(r.self.query).toBe("foo");
        expect(r.paths.flow).toBeDefined();
        expect(r.paths.stone).toBeUndefined();
    });

    test("三层组合", async () => {
        await write(
            path.join(world, "stones", "_builtin", "objects", "root", "self.md"),
            "---\n---\n",
        );
        await write(
            path.join(world, "stones", "main", "objects", "foo", "self.md"),
            "---\nextends: root\n---\n",
        );
        await write(
            path.join(world, "flows", "s_abc", "objects", "search_x1", "self.md"),
            "---\nextends: search\n---\n",
        );

        const records = await loadObjects({
            worldRoot: world,
            branch: "main",
            sessionId: "s_abc",
        });

        expect(records).toHaveLength(3);
        expect(records.filter((r) => r.kind === "builtin")).toHaveLength(1);
        expect(records.filter((r) => r.kind === "persistent")).toHaveLength(1);
        expect(records.filter((r) => r.kind === "ephemeral")).toHaveLength(1);
    });

    test("self.md 无 frontmatter 返回空 self", async () => {
        await write(
            path.join(world, "stones", "_builtin", "objects", "foo", "self.md"),
            "# 无 frontmatter\n",
        );
        const records = await loadObjects({ worldRoot: world });
        expect(records).toHaveLength(1);
        expect(records[0].self).toEqual({});
    });
});
```

- [ ] **Step 2: 跑测试**

```bash
cd /Users/zhangzhefu/x/ooc-2/ooc-3-wt && bun test src/executable/__tests__/loader.test.ts
```
Expected: 6 tests pass。

- [ ] **Step 3: stage**

```bash
git add src/executable/__tests__/loader.test.ts
```

---

### Task 10: 写 src/executable/registry.ts + tests

**Files:**
- Create: `/Users/zhangzhefu/x/ooc-2/ooc-3-wt/src/executable/registry.ts`
- Create test: `/Users/zhangzhefu/x/ooc-2/ooc-3-wt/src/executable/__tests__/registry.test.ts`

实现 Object registry：按 URI 索引、增删查、迭代。

- [ ] **Step 1: 写 registry.ts**

```typescript
/**
 * Object Registry: 按 URI 索引 ObjectRecord，提供 get / set / has / delete / list。
 *
 * 详见 spec §4.1 + §4.2。
 */

import type { ObjectRecord } from "../persistable/object-record";

export class ObjectRegistry {
    private readonly map = new Map<string, ObjectRecord>();

    /**
     * 注册或覆盖一个 ObjectRecord（按 uri key）。
     */
    set(record: ObjectRecord): void {
        this.map.set(record.uri, record);
    }

    /**
     * 按 URI 查找；未注册返回 undefined。
     */
    get(uri: string): ObjectRecord | undefined {
        return this.map.get(uri);
    }

    has(uri: string): boolean {
        return this.map.has(uri);
    }

    delete(uri: string): boolean {
        return this.map.delete(uri);
    }

    /**
     * 返回所有已注册 ObjectRecord 的迭代器。
     */
    list(): ObjectRecord[] {
        return Array.from(this.map.values());
    }

    /**
     * 清空整张表（仅用于测试 / loader 重建）。
     */
    clear(): void {
        this.map.clear();
    }

    get size(): number {
        return this.map.size;
    }
}
```

- [ ] **Step 2: 写测试**

```typescript
import { describe, expect, test } from "bun:test";
import type { ObjectRecord } from "../../persistable/object-record";
import { ObjectRegistry } from "../registry";

describe("ObjectRegistry", () => {
    function makeRecord(uri: string): ObjectRecord {
        return {
            uri,
            paths: { stone: "/tmp/x" },
            kind: "persistent",
            self: {},
        };
    }

    test("set / get / has roundtrip", () => {
        const r = new ObjectRegistry();
        const rec = makeRecord("ooc://stones/main/objects/foo");
        r.set(rec);
        expect(r.has(rec.uri)).toBe(true);
        expect(r.get(rec.uri)).toBe(rec);
    });

    test("get unknown returns undefined", () => {
        const r = new ObjectRegistry();
        expect(r.get("ooc://stones/main/objects/missing")).toBeUndefined();
    });

    test("set overwrites existing", () => {
        const r = new ObjectRegistry();
        const r1 = makeRecord("ooc://stones/main/objects/foo");
        const r2: ObjectRecord = { ...r1, self: { extends: "search" } };
        r.set(r1);
        r.set(r2);
        expect(r.get(r1.uri)).toBe(r2);
        expect(r.size).toBe(1);
    });

    test("delete + clear", () => {
        const r = new ObjectRegistry();
        r.set(makeRecord("ooc://stones/main/objects/a"));
        r.set(makeRecord("ooc://stones/main/objects/b"));
        expect(r.delete("ooc://stones/main/objects/a")).toBe(true);
        expect(r.size).toBe(1);
        r.clear();
        expect(r.size).toBe(0);
    });

    test("list returns all records", () => {
        const r = new ObjectRegistry();
        r.set(makeRecord("ooc://stones/main/objects/a"));
        r.set(makeRecord("ooc://stones/main/objects/b"));
        const all = r.list();
        expect(all).toHaveLength(2);
        expect(all.map((x) => x.uri).sort()).toEqual([
            "ooc://stones/main/objects/a",
            "ooc://stones/main/objects/b",
        ]);
    });
});
```

- [ ] **Step 3: 跑测试**

```bash
cd /Users/zhangzhefu/x/ooc-2/ooc-3-wt && bun test src/executable/__tests__/registry.test.ts
```
Expected: 5 tests pass。

- [ ] **Step 4: stage**

```bash
git add src/executable/registry.ts src/executable/__tests__/registry.test.ts
```

---

### Task 11: 写 src/executable/prototype-resolver.ts + tests

**Files:**
- Create: `/Users/zhangzhefu/x/ooc-2/ooc-3-wt/src/executable/prototype-resolver.ts`
- Create test: `/Users/zhangzhefu/x/ooc-2/ooc-3-wt/src/executable/__tests__/prototype-resolver.test.ts`

实现 spec §4.2 算法：沿 extends 链向上 fallback；循环检测；返回 chain 路径。

- [ ] **Step 1: 写 prototype-resolver.ts**

```typescript
/**
 * Prototype 链解析: 给定 ObjectRecord 与 key，沿 self.md `extends:` 链向上查找。
 *
 * 详见 spec §4.2。
 */

import type { ObjectRecord } from "../persistable/object-record";
import { resolveExtendsURI } from "../persistable/uri";
import type { ObjectRegistry } from "./registry";

/**
 * 解析 prototype 链：从 startUri 出发，沿 extends 字段向上，直到链终点（extends 为空或显式 null）。
 *
 * @returns 链上各 ObjectRecord 的 URI 列表，第一个是 startUri 自身；最后一个是链终点（通常 root）。
 * @throws 当出现环 / 无效 extends URI / 链上某节点不在 registry 中时抛错（boundary 严格）
 */
export function resolveChain(
    registry: ObjectRegistry,
    startUri: string,
): string[] {
    const visited = new Set<string>();
    const chain: string[] = [];
    let currentUri: string | undefined = startUri;
    while (currentUri) {
        if (visited.has(currentUri)) {
            throw new Error(
                `Cycle detected in extends chain: ${chain.join(" -> ")} -> ${currentUri}`,
            );
        }
        visited.add(currentUri);
        chain.push(currentUri);
        const record: ObjectRecord | undefined = registry.get(currentUri);
        if (!record) {
            throw new Error(
                `Object not found in registry while resolving chain: ${currentUri}`,
            );
        }
        const next = record.self.extends;
        if (!next) {
            break;
        }
        currentUri = resolveExtendsURI(next);
    }
    return chain;
}

/**
 * 在 prototype 链上找到第一个满足 predicate 的 ObjectRecord，返回 URI（链外没找到返回 undefined）。
 *
 * 用于 method / client fallback 解析: predicate = "该 record 拥有这个 method"。
 */
export function findInChain(
    registry: ObjectRegistry,
    startUri: string,
    predicate: (record: ObjectRecord) => boolean,
): string | undefined {
    const chain = resolveChain(registry, startUri);
    for (const uri of chain) {
        const record = registry.get(uri);
        if (record && predicate(record)) {
            return uri;
        }
    }
    return undefined;
}
```

- [ ] **Step 2: 写测试**

```typescript
import { describe, expect, test } from "bun:test";
import type { ObjectRecord } from "../../persistable/object-record";
import { ObjectRegistry } from "../registry";
import { findInChain, resolveChain } from "../prototype-resolver";

function buildRegistry(records: ObjectRecord[]): ObjectRegistry {
    const r = new ObjectRegistry();
    records.forEach((rec) => r.set(rec));
    return r;
}

function rec(uri: string, extendsValue?: string): ObjectRecord {
    return {
        uri,
        paths: { stone: "/tmp" },
        kind: "builtin",
        self: extendsValue ? { extends: extendsValue } : {},
    };
}

describe("prototype-resolver.resolveChain", () => {
    test("root 自身 (无 extends) → 链只含自己", () => {
        const reg = buildRegistry([rec("ooc://stones/_builtin/objects/root")]);
        const chain = resolveChain(reg, "ooc://stones/_builtin/objects/root");
        expect(chain).toEqual(["ooc://stones/_builtin/objects/root"]);
    });

    test("一层 extends: search → root", () => {
        const reg = buildRegistry([
            rec("ooc://stones/_builtin/objects/root"),
            rec("ooc://stones/_builtin/objects/search", "root"),
        ]);
        const chain = resolveChain(reg, "ooc://stones/_builtin/objects/search");
        expect(chain).toEqual([
            "ooc://stones/_builtin/objects/search",
            "ooc://stones/_builtin/objects/root",
        ]);
    });

    test("三层链 foo → bar → root", () => {
        const reg = buildRegistry([
            rec("ooc://stones/_builtin/objects/root"),
            rec("ooc://stones/_builtin/objects/bar", "root"),
            rec("ooc://stones/main/objects/foo", "ooc://stones/_builtin/objects/bar"),
        ]);
        const chain = resolveChain(reg, "ooc://stones/main/objects/foo");
        expect(chain).toEqual([
            "ooc://stones/main/objects/foo",
            "ooc://stones/_builtin/objects/bar",
            "ooc://stones/_builtin/objects/root",
        ]);
    });

    test("循环 a → b → a 抛错", () => {
        const reg = buildRegistry([
            rec("ooc://stones/main/objects/a", "ooc://stones/main/objects/b"),
            rec("ooc://stones/main/objects/b", "ooc://stones/main/objects/a"),
        ]);
        expect(() => resolveChain(reg, "ooc://stones/main/objects/a")).toThrow(
            /Cycle detected/,
        );
    });

    test("链上 missing node 抛错", () => {
        const reg = buildRegistry([
            rec("ooc://stones/main/objects/foo", "ooc://stones/_builtin/objects/missing"),
        ]);
        expect(() => resolveChain(reg, "ooc://stones/main/objects/foo")).toThrow(
            /not found in registry/,
        );
    });
});

describe("prototype-resolver.findInChain", () => {
    test("命中自身", () => {
        const reg = buildRegistry([
            rec("ooc://stones/_builtin/objects/root"),
            rec("ooc://stones/_builtin/objects/search", "root"),
        ]);
        const found = findInChain(reg, "ooc://stones/_builtin/objects/search", (r) =>
            r.uri.endsWith("search"),
        );
        expect(found).toBe("ooc://stones/_builtin/objects/search");
    });

    test("命中祖先", () => {
        const reg = buildRegistry([
            rec("ooc://stones/_builtin/objects/root"),
            rec("ooc://stones/_builtin/objects/search", "root"),
        ]);
        const found = findInChain(reg, "ooc://stones/_builtin/objects/search", (r) =>
            r.uri.endsWith("root"),
        );
        expect(found).toBe("ooc://stones/_builtin/objects/root");
    });

    test("链外无命中返回 undefined", () => {
        const reg = buildRegistry([
            rec("ooc://stones/_builtin/objects/root"),
            rec("ooc://stones/_builtin/objects/search", "root"),
        ]);
        const found = findInChain(reg, "ooc://stones/_builtin/objects/search", () =>
            false,
        );
        expect(found).toBeUndefined();
    });
});
```

- [ ] **Step 3: 跑测试**

```bash
cd /Users/zhangzhefu/x/ooc-2/ooc-3-wt && bun test src/executable/__tests__/prototype-resolver.test.ts
```
Expected: 8 tests pass (5 resolveChain + 3 findInChain)。

- [ ] **Step 4: stage**

```bash
git add src/executable/prototype-resolver.ts src/executable/__tests__/prototype-resolver.test.ts
```

---

### Task 12: P3 gate + commit

**Files:**
- Modify (stage existing): final P3 commit

- [ ] **Step 1: 全员 tsc + bun test**

```bash
cd /Users/zhangzhefu/x/ooc-2/ooc-3-wt && bunx tsc --noEmit
cd /Users/zhangzhefu/x/ooc-2/ooc-3-wt && bun test 2>&1 | tail -20
```

P3 gate: 新 loader / registry / prototype-resolver 单元测试全 PASS (loader 6 + registry 5 + prototype-resolver 8 = **19 个新测试**)。

- [ ] **Step 2: git status**

```bash
cd /Users/zhangzhefu/x/ooc-2/ooc-3-wt && git status --short
```
Expected: src/executable/* 已 staged。

- [ ] **Step 3: P3 commit**

```bash
cd /Users/zhangzhefu/x/ooc-2/ooc-3-wt && git commit -m "$(cat <<'EOF'
feat(p3): executable loader + Object registry + prototype 链解析

P3 阶段：新写 OOC-3 归一后的三个核心 executable 基础模块。

- src/executable/loader.ts: 三层源扫描（builtin/branch/flow current），
  从 self.md frontmatter 解析 extends 等元数据；递归处理 children/。
- src/executable/registry.ts: ObjectRecord 按 URI 索引的运行时表。
- src/executable/prototype-resolver.ts: 实现 spec §4.2 算法
  （resolveChain + findInChain 用于 method/UI fallback 查找；
   循环检测；缺失节点严格报错）。

测试: 6 loader + 5 registry + 8 prototype-resolver = 19 个新测试全 PASS。
P3 gate ✅。

下一 task (P4): root 原型 + defaultContext，需要这三个基础模块在位才能 wire。

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
cd /Users/zhangzhefu/x/ooc-2/ooc-3-wt && wc -l src/persistable/*.ts src/executable/*.ts
```

Expected: 5 commits (Plan 1 3 个 + P2 + P3)；branch=ooc-3，working tree clean。

P2+P3 完成。
