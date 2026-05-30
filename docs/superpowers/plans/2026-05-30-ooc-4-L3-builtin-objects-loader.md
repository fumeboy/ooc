# OOC-4 L3 builtin objects loader Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **执行纪律（OOC harness）**：执行 sub-agent **不要自己 commit / git add**——只写代码 + 跑测试到全绿，由 Supervisor 整合提交（带 co-author footer）。

**Goal:** 物化 8 个 builtin 原型骨架到 `stones/_builtin/objects/<proto>/`（root + program/search/file/knowledge/command_exec/skill_index/custom）+ 一个把它们扫描进 L2 `ObjectRegistry` 的 loader，并把物化挂进 app 启动 bootstrap（World invariant）。

**Architecture:** L3 是 L2（原型链引擎）与真实磁盘之间的桥。`_builtin` 是 **stones 伪分支**（`stoneDir({stonesBranch:"_builtin"})` 已天然支持），里面的原型是**框架派生投影**——不进 git、每次启动从 src 里的 seed 覆盖式重生（builtin 不可被用户 override，只能 fork，所以覆盖安全）。L3 **只物化骨架**（self.md 建立 extends 链 + root 的兜底 readable.md），**不转写 window behavior**（那是 L4），**不接活 render/command resolve**（L4+），**不加 HTTP 路由**。loader 产出的 registry 由 L4 接入活路径；L3 阶段仅被测试消费。

**Tech Stack:** TypeScript / bun runtime；`bun:test`；复用 L2 `src/executable/prototype/`（`loadObjectRecord` / `buildObjectRegistry` / `resolveAlongChain` / `builtinProtoId` / `BUILTIN_BRANCH`）；复用 `@src/persistable`（`createStoneObject` / `writeSelf` / `writeReadable` / `STONE_OBJECTS_SUBDIR`）；bootstrap 挂在 `src/app/server/index.ts` main。

---

## 设计决策（权威，执行不得偏离）

锚定伞 spec §3.2 / §9（L3 行）+ 宪法 `object.doc.ts:root.patches.ooc4_object_model`（prototype_chain / ab_classification）。

### D1 8 个原型与 extends 链

| 原型 | self.md `extends` | readable.md | 说明 |
|---|---|---|---|
| `root` | `null`（YAML null，链终点） | **非空**（终极兜底文案） | 所有原型的祖先；spec §3.2 |
| `program` | `root` | 空（沿链兜底到 root） | A 类实体原型 |
| `search` | `root` | 空 | A 类 |
| `file` | `root` | 空 | A 类 |
| `knowledge` | `root` | 空 | A 类 |
| `command_exec` | `root` | 空 | A 类 |
| `skill_index` | `root` | 空 | A 类 |
| `custom` | `root` | 空 | A 类 |

> 7 个非 root 原型的 readable.md 留空（createStoneObject 预创建的空占位）→ `has.readable=false` → 在 loader 测试中演示「resolve readable 沿链兜底到 root」，把 L2+L3 串起来验证。behavior（executable/ commands、真实 readable 文案）由 L4 转写，L3 不做。

### D2 `_builtin` 是框架派生投影（覆盖式幂等）

- `ensureBuiltinObjects(baseDir)` 每次启动对 8 个原型：`createStoneObject(ref)`（idempotent 建目录+marker+空 self/readable）→ `writeSelf(ref, <frontmatter+body>)` → root 额外 `writeReadable`。**覆盖式**，不做 marker-skip——避免 seed 升级后 `_builtin` stale；安全因为 builtin 不可被用户 override（spec §3.2「不支持 override builtin，只支持 fork」）。
- `_builtin` 在 `stones/` 下、**在 main worktree 之外**，`createStoneObject` 是纯 fs（不 commit）→ `_builtin` 不进任何 git（与 ensureSupervisor/User 直写 main worktree + gitCommitAll 不同）。
- `ref.stonesBranch = "_builtin"`（= L2 `BUILTIN_BRANCH`）→ `stoneDir` 算出 `<baseDir>/stones/_builtin/objects/<proto>`。canonical id = `builtinProtoId(proto)` = `ooc://stones/_builtin/objects/<proto>`（L2 `canonicalObjectId` 对 `_builtin` 分支与 `builtinProtoId` 同源，L2 constants.test 已交叉验证）。

### D3 物化挂进 live startup（World invariant，FATAL）

`ensureBuiltinObjects` 挂在 `src/app/server/index.ts` main，**ensureUserObject 之后、runRecoveryCheck 之前**，与 supervisor/user 同款 try/catch + 失败 FATAL rethrow（builtin 原型根是 World bootstrap invariant）。recovery-check 只扫 `stones/main/objects/`，不碰 `_builtin`，无干扰。

### D4 migration 安全性（已核实，加 belt-and-suspenders）

`migrateFlatToMain`（`src/persistable/stone-bootstrap.ts:221-245`）由 `hasMain` 守卫：`stones/main` 存在即 `return false` 不迁移。`ensureStoneRepo`（建 main）每启动都在 `ensureBuiltinObjects`（建 _builtin）之前 → 迁移可能运行时 `_builtin` 尚不存在；`_builtin` 存在时 `main` 必已存在 → 迁移早返回。**`_builtin` 永不被误扫**。仍把 `"_builtin"` 加进 `RESERVED_TOP_LEVEL`（防 main 被手删的 pathological 场景）——用字面量 + 注释，不引入 persistable→executable 层级倒置。

### D5 loader 形态

`loadBuiltinRegistry(baseDir): Promise<ObjectRegistry>`（`src/executable/prototype/builtin-loader.ts`）：readdir `stones/_builtin/objects/` 顶层目录 → 每个 `loadObjectRecord({objectId, stonesBranch:"_builtin"})` → `buildObjectRegistry(records)`。`_builtin` 目录缺失（ensureBuiltinObjects 没跑）→ fail-loud 抛错。

### D6 L3 明确不做（scope 围栏）

不转写 window behavior（executable commands / 真实 readable / visible）= L4/L8；不把 registry 接进活 render/command resolve = L4；不加 HTTP 路由（无 route-audit 改动）；不给 `_builtin` 建 git。

> 副作用提示（非回归）：`_builtin` 非 dot 前缀，落地后会出现在 `/api/tree?scope=world|stones` 的目录树里（`src/app/server/modules/ui/service.ts` 递归 walk `stones/`，仅过滤 dot 前缀），并被 `markerFor` 标为 `marker="stone"`。纯展示、不崩、L3 不对此断言；记此一笔避免体验官误报为意外回归。`/api/stones`（listStones 只读 `stones/<branch>/objects`）不受影响，不会把 `_builtin` 当分支/对象列出。

---

## File Structure

```
src/app/server/bootstrap/
├── builtin-seed.ts                       # 新增：8 原型 seed（name/extends/self/readable）
├── ensure-builtin-objects.ts             # 新增：ensureBuiltinObjects 物化
└── __tests__/
    └── ensure-builtin-objects.test.ts    # 新增：物化 + 幂等 测试

src/executable/prototype/
├── builtin-loader.ts                     # 新增：loadBuiltinRegistry 扫描入 registry
├── index.ts                              # 改：barrel re-export loadBuiltinRegistry
└── __tests__/
    └── builtin-loader.test.ts            # 新增：扫描→8 原型→链→兜底 resolve

src/persistable/stone-bootstrap.ts        # 改：RESERVED_TOP_LEVEL += "_builtin"（D4 防御）
src/app/server/index.ts                   # 改：main 挂 ensureBuiltinObjects（D3）
```

---

## Task 1: builtin-seed — 8 原型 seed 定义

**Files:**
- Create: `src/app/server/bootstrap/builtin-seed.ts`
- Test: （无独立 test；由 Task 2 的 ensure 测试间接覆盖）

- [ ] **Step 1: Write the seed module**

```ts
// src/app/server/bootstrap/builtin-seed.ts
/**
 * 8 个 builtin 原型的 seed（OOC-4 L3）。
 *
 * _builtin 原型是框架派生投影：ensureBuiltinObjects 每启动从这里覆盖式重生
 * stones/_builtin/objects/<name>/。L3 只物化骨架（self.md 建立 extends 链 +
 * root 的兜底 readable.md）；window behavior（executable commands / 真实 readable /
 * visible）由 L4/L8 转写。
 *
 * 权威：docs/superpowers/specs/2026-05-30-ooc-4-incremental-object-unification-design.md §3.2。
 */

/** 单个 builtin 原型的 seed。 */
export interface BuiltinPrototypeSeed {
  /** 原型名 = objectId（stones/_builtin/objects/<name>）。 */
  name: string;
  /** self.md frontmatter extends 原始值：null=链终点（仅 root）；"root"=继承 root。 */
  extends: string | null;
  /** self.md body（frontmatter 之后的正文）。 */
  self: string;
  /** 非空才 writeReadable；省略=留空占位（沿链兜底）。 */
  readable?: string;
}

export const BUILTIN_ROOT_NAME = "root";

/** 8 原型（root + 7 个 A 类实体），spec §3.2。顺序无关，root 不必排首。 */
export const BUILTIN_PROTOTYPES: ReadonlyArray<BuiltinPrototypeSeed> = [
  {
    name: "root",
    extends: null,
    self: "OOC-4 root 原型：所有 Object 的原型链终点。方法 / visible / readable 沿 extends 链向上找不到时由 root 兜底。",
    readable:
      "root 原型（OOC-4 prototype chain 兜底）。任何未自定义对外展示的 Object 最终落到这里。",
  },
  { name: "program", extends: BUILTIN_ROOT_NAME, self: "OOC-4 program 原型：代码执行实体（A 类）。behavior 由 L4 转写自 windows/program。" },
  { name: "search", extends: BUILTIN_ROOT_NAME, self: "OOC-4 search 原型：搜索/探索实体（A 类）。behavior 由 L4 转写自 windows/search。" },
  { name: "file", extends: BUILTIN_ROOT_NAME, self: "OOC-4 file 原型：文件实体（A 类）。behavior 由 L4 转写自 windows/file。" },
  { name: "knowledge", extends: BUILTIN_ROOT_NAME, self: "OOC-4 knowledge 原型：知识展示实体（A 类）。behavior 由 L4 转写自 windows/knowledge。" },
  { name: "command_exec", extends: BUILTIN_ROOT_NAME, self: "OOC-4 command_exec 原型：命令表单实体（A 类）。behavior 由 L4 转写自 windows/command_exec。" },
  { name: "skill_index", extends: BUILTIN_ROOT_NAME, self: "OOC-4 skill_index 原型：技能索引实体（A 类）。behavior 由 L4 转写自 windows/skill_index。" },
  { name: "custom", extends: BUILTIN_ROOT_NAME, self: "OOC-4 custom 原型：用户自定义 Object 实体（A 类）。behavior 由 L4 转写自 windows/custom。" },
];

/** 把 seed 拼成 self.md 全文（frontmatter + body）。extends=null → YAML `null`。 */
export function buildSelfMd(seed: BuiltinPrototypeSeed): string {
  const ext = seed.extends === null ? "null" : seed.extends;
  return `---\nextends: ${ext}\n---\n${seed.self}\n`;
}
```

- [ ] **Step 2: Verify it compiles**

Run: `bun tsc --noEmit src/app/server/bootstrap/builtin-seed.ts`
Expected: 0 error（独立文件无外部依赖）

---

## Task 2: ensure-builtin-objects — 物化 + 幂等

**Files:**
- Create: `src/app/server/bootstrap/ensure-builtin-objects.ts`
- Test: `src/app/server/bootstrap/__tests__/ensure-builtin-objects.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/app/server/bootstrap/__tests__/ensure-builtin-objects.test.ts
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, test } from "bun:test";
import { ensureBuiltinObjects } from "../ensure-builtin-objects";
import { BUILTIN_PROTOTYPES } from "../builtin-seed";

let tempRoot: string | undefined;
afterEach(async () => {
  if (tempRoot) {
    await rm(tempRoot, { recursive: true, force: true });
    tempRoot = undefined;
  }
});

function selfPath(baseDir: string, proto: string): string {
  return join(baseDir, "stones", "_builtin", "objects", proto, "self.md");
}
function readablePath(baseDir: string, proto: string): string {
  return join(baseDir, "stones", "_builtin", "objects", proto, "readable.md");
}

describe("ensureBuiltinObjects", () => {
  test("materializes all 8 prototypes with extends frontmatter", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-builtin-"));
    const result = await ensureBuiltinObjects({ baseDir: tempRoot });
    expect(result.materialized.sort()).toEqual(
      ["command_exec", "custom", "file", "knowledge", "program", "root", "search", "skill_index"],
    );
    // root: extends null
    const rootSelf = await readFile(selfPath(tempRoot, "root"), "utf8");
    expect(rootSelf).toContain("extends: null");
    // program: extends root
    const progSelf = await readFile(selfPath(tempRoot, "program"), "utf8");
    expect(progSelf).toContain("extends: root");
  });

  test("root has non-empty readable.md; non-root protos leave empty placeholder", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-builtin-"));
    await ensureBuiltinObjects({ baseDir: tempRoot });
    const rootReadable = await readFile(readablePath(tempRoot, "root"), "utf8");
    expect(rootReadable.trim().length).toBeGreaterThan(0);
    const progReadable = await readFile(readablePath(tempRoot, "program"), "utf8");
    expect(progReadable.trim().length).toBe(0);
  });

  test("idempotent: running twice yields stable content (overwrite-regenerate)", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-builtin-"));
    await ensureBuiltinObjects({ baseDir: tempRoot });
    const firstRoot = await readFile(selfPath(tempRoot, "root"), "utf8");
    const second = await ensureBuiltinObjects({ baseDir: tempRoot });
    expect(second.materialized.length).toBe(BUILTIN_PROTOTYPES.length);
    const secondRoot = await readFile(selfPath(tempRoot, "root"), "utf8");
    expect(secondRoot).toBe(firstRoot);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/app/server/bootstrap/__tests__/ensure-builtin-objects.test.ts`
Expected: FAIL（`Cannot find module "../ensure-builtin-objects"`）

- [ ] **Step 3: Write minimal implementation**

```ts
// src/app/server/bootstrap/ensure-builtin-objects.ts
/**
 * ensureBuiltinObjects — World bootstrap invariant：物化 8 个 builtin 原型骨架到
 * stones/_builtin/objects/<proto>/。
 *
 * _builtin 是框架派生投影：覆盖式重生（每启动从 builtin-seed 重写），不进 git
 * （createStoneObject 纯 fs；_builtin 在 main worktree 之外）。builtin 不可被用户
 * override（spec §3.2），故覆盖安全。L3 只物化骨架；behavior 由 L4 转写。
 */

import { createStoneObject, writeSelf, writeReadable } from "@src/persistable";
import { BUILTIN_BRANCH } from "@src/executable/prototype";
import { BUILTIN_PROTOTYPES, buildSelfMd } from "./builtin-seed";

/** ensureBuiltinObjects 结果。 */
export interface EnsureBuiltinObjectsResult {
  /** 本次物化的原型名（覆盖式，每次都是全部）。 */
  materialized: string[];
}

/**
 * 物化全部 builtin 原型。覆盖式幂等：每次都对 8 原型 createStoneObject + writeSelf
 * （+ root writeReadable），同 seed → 同输出。
 */
export async function ensureBuiltinObjects(opts: { baseDir: string }): Promise<EnsureBuiltinObjectsResult> {
  const materialized: string[] = [];
  for (const seed of BUILTIN_PROTOTYPES) {
    const ref = { baseDir: opts.baseDir, objectId: seed.name, stonesBranch: BUILTIN_BRANCH };
    await createStoneObject(ref);
    await writeSelf(ref, buildSelfMd(seed));
    if (seed.readable !== undefined && seed.readable.length > 0) {
      await writeReadable(ref, seed.readable);
    }
    materialized.push(seed.name);
  }
  return { materialized };
}
```

> **执行注**：`@src/persistable` alias 已被同目录其它 bootstrap 文件使用（见 `ensure-user.ts:26`），`@src/executable/prototype` 应同样可解析（tsconfig paths `@src/*`）。若 `@src/executable/prototype` 解析失败，回退相对路径 `../../../executable/prototype`。`BUILTIN_BRANCH` 由 L2 prototype barrel 导出（= `"_builtin"`）。

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/app/server/bootstrap/__tests__/ensure-builtin-objects.test.ts`
Expected: PASS（3 tests）

---

## Task 3: builtin-loader — 扫描入 L2 registry

**Files:**
- Create: `src/executable/prototype/builtin-loader.ts`
- Test: `src/executable/prototype/__tests__/builtin-loader.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/executable/prototype/__tests__/builtin-loader.test.ts
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, test } from "bun:test";
import { ensureBuiltinObjects } from "../../../app/server/bootstrap/ensure-builtin-objects";
import { loadBuiltinRegistry } from "../builtin-loader";
import { builtinProtoId } from "../constants";
import { resolveAlongChain } from "../resolve";

let tempRoot: string | undefined;
afterEach(async () => {
  if (tempRoot) {
    await rm(tempRoot, { recursive: true, force: true });
    tempRoot = undefined;
  }
});

describe("loadBuiltinRegistry", () => {
  test("scans the 8 materialized prototypes into a registry", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-blreg-"));
    await ensureBuiltinObjects({ baseDir: tempRoot });
    const reg = await loadBuiltinRegistry(tempRoot);
    expect(reg.ids().length).toBe(8);
    expect(reg.has(builtinProtoId("root"))).toBe(true);
    expect(reg.has(builtinProtoId("program"))).toBe(true);
  });

  test("root is chain terminus; non-root protos extend root", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-blreg-"));
    await ensureBuiltinObjects({ baseDir: tempRoot });
    const reg = await loadBuiltinRegistry(tempRoot);
    expect(reg.get(builtinProtoId("root"))?.extends).toBeNull();
    expect(reg.get(builtinProtoId("search"))?.extends).toBe(builtinProtoId("root"));
  });

  test("readable resolves up the chain to root for a non-root proto (L2+L3)", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-blreg-"));
    await ensureBuiltinObjects({ baseDir: tempRoot });
    const reg = await loadBuiltinRegistry(tempRoot);
    // program 自身 readable 空 → 沿 extends 兜底到 root（root.has.readable=true）
    const hit = resolveAlongChain(reg, builtinProtoId("program"), (rec) =>
      rec.has.readable ? rec.id : undefined,
    );
    expect(hit?.record.id).toBe(builtinProtoId("root"));
  });

  test("throws when _builtin dir is absent (ensureBuiltinObjects not run)", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-blreg-"));
    await expect(loadBuiltinRegistry(tempRoot)).rejects.toThrow(/_builtin|不存在/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/executable/prototype/__tests__/builtin-loader.test.ts`
Expected: FAIL（`Cannot find module "../builtin-loader"`）

- [ ] **Step 3: Write minimal implementation**

```ts
// src/executable/prototype/builtin-loader.ts
import { readdir } from "node:fs/promises";
import type { Dirent } from "node:fs";
import { join } from "node:path";
import { STONE_OBJECTS_SUBDIR } from "../../persistable";
import { BUILTIN_BRANCH } from "./constants";
import { loadObjectRecord, type ObjectRecord } from "./object-record";
import { buildObjectRegistry, type ObjectRegistry } from "./registry";

/**
 * 扫描 stones/_builtin/objects/ 下全部原型，loadObjectRecord 每个，build 成 L2 registry
 * （含拓扑校验）。_builtin 目录缺失 → fail-loud。
 *
 * L3 阶段仅被测试消费；接入活 render/command resolve 是 L4。
 */
export async function loadBuiltinRegistry(baseDir: string): Promise<ObjectRegistry> {
  const dir = join(baseDir, "stones", BUILTIN_BRANCH, STONE_OBJECTS_SUBDIR);
  // 必须显式 cast `as Dirent[]`：withFileTypes 在本仓库 tsconfig(types:[bun,node]) 下
  // 会解析成 Buffer 重载 Dirent<NonSharedBuffer>[]，使 e.name 变 Buffer 导致 .startsWith
  // 报 tsc error。沿用既有 precedent src/app/server/modules/ui/service.ts:88-92。
  let entries: Dirent[];
  try {
    entries = (await readdir(dir, { withFileTypes: true })) as Dirent[];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`loadBuiltinRegistry: ${dir} 不存在——ensureBuiltinObjects 未运行?`);
    }
    throw error;
  }
  const protoNames = entries
    .filter((e) => e.isDirectory() && !e.name.startsWith("."))
    .map((e) => e.name);

  const records: ObjectRecord[] = [];
  for (const name of protoNames) {
    records.push(await loadObjectRecord({ baseDir, objectId: name, stonesBranch: BUILTIN_BRANCH }));
  }
  return buildObjectRegistry(records);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/executable/prototype/__tests__/builtin-loader.test.ts`
Expected: PASS（4 tests）

---

## Task 4: barrel — 导出 loadBuiltinRegistry

**Files:**
- Modify: `src/executable/prototype/index.ts`
- Test: 复用 `src/executable/prototype/__tests__/index.test.ts`（补一条断言）

- [ ] **Step 1: Add the export**

在 `src/executable/prototype/index.ts` 末尾加：

```ts
export { loadBuiltinRegistry } from "./builtin-loader";
```

- [ ] **Step 2: Extend the barrel test**

在 `src/executable/prototype/__tests__/index.test.ts` 的 `re-exports all public symbols` test 内补一行：

```ts
    expect(typeof proto.loadBuiltinRegistry).toBe("function");
```

- [ ] **Step 3: Run test to verify it passes**

Run: `bun test src/executable/prototype/__tests__/index.test.ts`
Expected: PASS

---

## Task 5: RESERVED_TOP_LEVEL 防御 + 挂进 startup

**Files:**
- Modify: `src/persistable/stone-bootstrap.ts:37`
- Modify: `src/app/server/index.ts`（import + main 调用）

- [ ] **Step 1: 加 `_builtin` 到 RESERVED_TOP_LEVEL（D4 防御）**

`src/persistable/stone-bootstrap.ts:37` 当前：

```ts
const RESERVED_TOP_LEVEL = new Set([STONES_MAIN_BRANCH, STONES_BARE_REPO_DIR, ".git", ".gitignore"]);
```

改为（加 `"_builtin"` 字面量 + 注释；不 import executable 层常量以免层级倒置）：

```ts
// "_builtin" = OOC-4 builtin 原型伪分支（stones/_builtin/objects/<proto>，见
// src/executable/prototype/constants.ts BUILTIN_BRANCH）。是 world-level 伪分支，
// 与 main 平级，migrateFlatToMain 永不应把它扫进 main/objects/（防 main 被手删的边界）。
const RESERVED_TOP_LEVEL = new Set([STONES_MAIN_BRANCH, STONES_BARE_REPO_DIR, "_builtin", ".git", ".gitignore"]);
```

- [ ] **Step 2: import + 挂进 index.ts main**

`src/app/server/index.ts` 顶部 import 区（紧邻第 10 行 `import { ensureUserObject } from "./bootstrap/ensure-user";`）加：

```ts
import { ensureBuiltinObjects } from "./bootstrap/ensure-builtin-objects";
```

在 main 里 `ensureUserObject` 的 try/catch 块**之后**（即原第 302 行 `}` 之后）、`runRecoveryCheck` 的注释（原第 304 行）**之前**插入：

```ts
  // OOC-4 L3: builtin 原型是 World bootstrap invariant——物化 stones/_builtin/objects/<proto>/
  // （8 原型骨架，root + 7 A 类）。框架派生投影，覆盖式重生，不进 git。失败 FATAL
  //（原型链根缺失 = 原型系统不可用）。behavior 转写见 L4。
  try {
    const builtins = await ensureBuiltinObjects({ baseDir: config.baseDir });
    console.log(`[ooc-app-server] builtin prototypes materialized: ${builtins.materialized.join(", ")}`);
  } catch (e) {
    console.error(`[ooc-app-server] ensureBuiltinObjects FATAL: ${e instanceof Error ? e.message : e}`);
    throw e;
  }
```

- [ ] **Step 3: 类型检查**

Run: `bun tsc --noEmit`
Expected: 不新增 error（pre-existing 的 2 个 `tests/integration/` error 与本层无关，下文回归说明）。

---

## Task 6: 全量回归（Supervisor 整合阶段执行）

> sub-agent 执行完 Task 1-5 交回；本任务由 Supervisor 跑。

- [ ] **Step 1: L3 新模块单测全绿**

Run: `bun test src/app/server/bootstrap/__tests__/ensure-builtin-objects.test.ts src/executable/prototype/`
Expected: 全 PASS（ensure 3 + prototype 模块原 31 + builtin-loader 4 + index barrel 增强 = ~38 tests）

- [ ] **Step 2: src 全量回归（基线 L2 后 1049 pass，不得回退）**

Run: `bun test src/`
Expected: ≥1049 + L3 新增（~10），0 fail，3 skip。**任何既有测试转红 = L3 越界，排查。**

- [ ] **Step 3: tsc 全量**

Run: `bun tsc --noEmit 2>&1 | grep -E "error TS"`
Expected: **仅** 2 个 pre-existing error（`tests/integration/meta-programming.integration.test.ts` 的 `readServerSource` + `relation-write-on-talk.integration.test.ts` 的 `writeReadme`，均 Inc1/Inc2 改名遗留，与 L3 无关）。L3 新增 0。若多于这 2 个 → L3 引入了类型错误，排查。

- [ ] **Step 4: 真实启动 e2e（验证 live bootstrap 不破）**

Run: `RUN_BACKEND_E2E=1 bun test tests/e2e/backend/route-audit.e2e.test.ts`
Expected: PASS。route-audit 起真子进程 `bun src/app/server/index.ts --world <tmp>`，现在启动会跑 ensureBuiltinObjects；确认①启动不崩 ②无新增 404（L3 不加路由）。**用全新 tmp world（fixture 已是 mkdtemp）避免旧布局假绿。**

- [ ] **Step 5: scope 围栏**

Run: `git status --short`
Expected: 改动 = 新增 `src/app/server/bootstrap/{builtin-seed,ensure-builtin-objects}.ts` + `__tests__/ensure-builtin-objects.test.ts`、新增 `src/executable/prototype/{builtin-loader.ts,__tests__/builtin-loader.test.ts}`、改 `src/executable/prototype/index.ts` + `__tests__/index.test.ts`、改 `src/persistable/stone-bootstrap.ts`、改 `src/app/server/index.ts` + plan 文档（+ 稍后 meta）。**未触碰** render/command 活 resolve、windows/_shared/registry.ts。

---

## 验证 gate 总览（对齐 spec §9 L3 行「8 原型加载 e2e」；§11.7 的 public method 路由是 L4）

- [ ] 8 原型物化：`stones/_builtin/objects/{root,program,search,file,knowledge,command_exec,skill_index,custom}/self.md` 存在且含正确 extends — `ensure-builtin-objects.test.ts`。
- [ ] root extends null（链终点）；7 个 extends root — `builtin-loader.test.ts`。
- [ ] loader 扫描成 registry（8 records，拓扑无环、无悬空）— `builtin-loader.test.ts`。
- [ ] readable 沿链兜底到 root（L2+L3 串联）— `builtin-loader.test.ts`。
- [ ] 覆盖式幂等：跑两次内容稳定 — `ensure-builtin-objects.test.ts`。
- [ ] live startup 挂载不破：route-audit e2e PASS。
- [ ] src 全量 ≥1049 + tsc 仅 2 个 pre-existing error。

不测（YAGNI）：override builtin（不支持）；_builtin 进 git（不进）；behavior resolve（L4）。

---

## meta 文档更新

L3 落地后更新 `meta/object.doc.ts`：
- `root.patches.ooc4_object_model.children.prototype_chain.todo`：补「L3 已落地：ensureBuiltinObjects 物化 8 原型骨架到 stones/_builtin/objects/ + loadBuiltinRegistry 扫描入 L2 registry（live startup invariant，覆盖式重生不进 git）；behavior 转写 / 接活 resolve 待 L4。」

改完立刻 `bun tsc --noEmit meta/object.doc.ts`。本步在 Task 6 Step 5 scope 检查**之后**跑，避免 object.doc.ts 干扰 git 判读。

> 无新增 HTTP 路由 → 不改 `tests/e2e/backend/route-audit.e2e.test.ts` 的 RouteCase 清单（只是借它验证 live 启动）。
