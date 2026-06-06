# OOC Class Spec A 实现计划（继承统一重构）

> **For agentic workers:** 用 superpowers:executing-plans 逐任务实现。步骤用 `- [ ]` 跟踪。
> 设计权威：`docs/2026-06-07-ooc-class-first-class-inheritance-design.md`。

**Goal:** 把 class 提升为一等继承抽象（唯一继承机制，剔除 prototype），统一到 registry
`class:<id>` 命名空间 + 单一 class 链文件解析原语，并修 builtin 源解析——不改 welcome 行为。

**Architecture:** 新增 persistable 层 builtin/class 目录解析（读路径，框架包优先），ObjectRegistry
class 注册到 `class:` 命名空间消歧，五件套读取沿 class 链回退；prototype 全删。

**Tech Stack:** TypeScript / bun / bun:test；monorepo `packages/@ooc/core`。

---

## 文件结构

| 文件 | 责任 | 改动 |
|---|---|---|
| `packages/@ooc/core/persistable/builtin-dir.ts` | builtin 框架包目录解析（Bun.resolveSync） | 新建 |
| `packages/@ooc/core/persistable/stone-self.ts` | readSelf 走 builtin 框架包 | 改 |
| `packages/@ooc/core/persistable/stone-readme.ts` / `stone-server.ts` | 同上 | 改 |
| `packages/@ooc/core/persistable/common.ts` | `oocMetadata.kind="class"`、classes/ 路径 | 改 |
| `packages/@ooc/core/runtime/stone-registry.ts` | 扫 classes/、StoneDefinition.kind、删 prototype 字段 | 改 |
| `packages/@ooc/core/runtime/object-registry.ts` | class:<id> 命名空间注册 + 解析 | 改 |
| `packages/@ooc/core/runtime/object-type-registrar.ts` | 读 ooc.class（替 prototype）；executable 沿链回退 | 改 |
| `packages/@ooc/core/thinkable/knowledge/loader.ts` | knowledge 沿 class:<id> 链到 classes/ 或框架包 | 改 |
| `packages/@ooc/core/thinkable/knowledge/synthesizer.ts` | 删 readSelfPrototype + 内联 prototype 回退；visible/readable 沿链回退 | 改 |
| `packages/@ooc/core/executable/object/object-types.ts` | 删 StoneObjectDeclaration.prototype | 改 |
| `packages/@ooc/cli/src/commands/init.ts:218` | ooc.prototype→ooc.class | 改 |
| `scripts/check-no-deprecated-symbols.sh` | 加 prototype 守门 | 改 |
| `packages/@ooc/meta/object.doc.ts` | class 一等节点 + 删 prototype 表述 | 改 |

---

## P0：builtin 源解析改指框架包

### Task 1: builtin 框架包目录解析原语

**Files:**
- Create: `packages/@ooc/core/persistable/builtin-dir.ts`
- Test: `packages/@ooc/core/persistable/builtin-dir.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
import { describe, expect, test } from "bun:test";
import { resolveBuiltinDir } from "./builtin-dir";
import { existsSync } from "node:fs";
import { join } from "node:path";

describe("resolveBuiltinDir", () => {
  test("resolves supervisor builtin to the framework package dir (not world packages/)", () => {
    const dir = resolveBuiltinDir("supervisor");
    expect(dir).toBeDefined();
    expect(existsSync(join(dir!, "self.md"))).toBe(true);
  });
  test("returns undefined for a non-builtin id", () => {
    expect(resolveBuiltinDir("some_user_stone")).toBeUndefined();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `bun test packages/@ooc/core/persistable/builtin-dir.test.ts`
Expected: FAIL（resolveBuiltinDir 未定义）

- [ ] **Step 3: 最小实现**

```ts
import { dirname } from "node:path";
import { BUILTIN_OBJECT_IDS } from "../_shared/types/thread.js";

/**
 * 解析 builtin 五件套所在的框架包目录（运行进程的 node_modules/@ooc/builtins/<id>）。
 *
 * 根因（2026-06-07）：旧 stoneDir(builtinRef) 指向 <world>/packages/@ooc/builtins/<id>，
 * 任何 world 该目录都空 → builtin self.md/knowledge 磁盘读永远落空。builtin 定义随框架代码
 * 发布，应从运行进程解析。仅用于读路径；builtin 不可写。
 */
export function resolveBuiltinDir(objectId: string): string | undefined {
  const id = objectId.startsWith("_builtin/") ? objectId.slice("_builtin/".length) : objectId;
  if (!BUILTIN_OBJECT_IDS.has(id) && !objectId.startsWith("_builtin/")) return undefined;
  try {
    return dirname(Bun.resolveSync(`@ooc/builtins/${id}/package.json`, process.cwd()));
  } catch {
    return undefined;
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `bun test packages/@ooc/core/persistable/builtin-dir.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add packages/@ooc/core/persistable/builtin-dir.ts packages/@ooc/core/persistable/builtin-dir.test.ts
git commit -m "feat(persistable): resolveBuiltinDir 从框架包解析 builtin 目录（P0）"
```

### Task 2: readSelf/readReadable/readExecutableSource 对 builtin 走框架包

**Files:**
- Modify: `packages/@ooc/core/persistable/stone-self.ts`, `stone-readme.ts`, `stone-server.ts`
- Test: `packages/@ooc/core/persistable/builtin-read.test.ts`

- [ ] **Step 1: 写失败测试**（用临时空 world，builtin self 仍应读到框架内容）

```ts
import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readSelf } from "./stone-self";

describe("builtin self read (framework package, not world packages/)", () => {
  test("readSelf(supervisor) returns framework self.md even in empty world", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "ooc-builtin-read-"));
    try {
      const text = await readSelf({ baseDir, objectId: "supervisor" });
      expect(text ?? "").toContain("supervisor");
    } finally {
      await rm(baseDir, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `bun test packages/@ooc/core/persistable/builtin-read.test.ts`
Expected: FAIL（readSelf 走空 world packages → undefined）

- [ ] **Step 3: 实现**——在 `selfFile`/`readableFile`/executable 源路径解析处，若 ref 是
builtin，则用 `resolveBuiltinDir(ref.objectId)` 作为目录基；否则 `stoneDir(ref)`。

`stone-self.ts`:
```ts
import { resolveBuiltinDir } from "./builtin-dir.js";
import { BUILTIN_OBJECT_IDS } from "../_shared/types/thread.js";

function selfReadDir(ref: StoneObjectRef): string {
  if (ref._stonesBranch == null && (ref.objectId.startsWith("_builtin/") || BUILTIN_OBJECT_IDS.has(ref.objectId))) {
    const b = resolveBuiltinDir(ref.objectId);
    if (b) return b;
  }
  return stoneDir(ref);
}
export function selfFile(ref: StoneObjectRef): string {
  return join(selfReadDir(ref), "self.md");
}
```
（`stone-readme.ts` 的 `readableFile`、`stone-server.ts` 的 executable 源路径同构改造。）

- [ ] **Step 4: 跑测试确认通过 + 既有 persistable 测试不回归**

Run: `bun test packages/@ooc/core/persistable/`
Expected: PASS（含既有用例）

- [ ] **Step 5: 提交**

```bash
git add packages/@ooc/core/persistable/
git commit -m "fix(persistable): builtin 五件套读路径走框架包，修 self.md 磁盘空读（P0）"
```

### Task 3: P0 验收——HTTP getSelf(supervisor) 读到框架 self.md

- [ ] **Step 1**: 起后端指向全新空 world，`curl /api/stones/supervisor/self`（经 §5.3 前
ensureStoneExists 仍会 404——P0 仅修 read 原语，HTTP getStone 存在性校验在 P1/SpecB 调整）。
**改为单测验收**：Task 2 的测试即 P0 验收。tsc gate：

Run: `bun run check:tsc`
Expected: OK

- [ ] **Step 2: 提交（若有 tsc 修复）**

---

## P1a：class 一等化 + 命名空间（任务级，执行时细化为 TDD）

- **T4 classes/ 持久层**：`common.ts` 支持 `stones/<branch>/classes/<id>/` 路径解析；
  `stone-registry.ts` rescan 扫 classes/ 子树，条目 `StoneDefinition.kind="class"`。
  测试：在临时 world 建 `classes/foo/package.json(ooc.kind=class)`，registry.list() 含 foo 且 kind=class。
- **T5 StoneDefinition.kind 判别**：`oocMetadata.kind` 支持 `"class"`；删除 `oocMetadata.prototype` 字段。
- **T6 ObjectRegistry class 命名空间**：class 注册键 `class:<id>`；`resolveParentClassChain`/
  `resolveMethod` 起步从 instance type 跳到 `class:<className>`。
  测试（**C1 回归**）：instance type "supervisor" + parentClass "class:supervisor" + class
  "class:supervisor" parentClass undefined→root；resolveMethod 命中 class 方法，无自引用 break。
- **T7 object ooc.class 载体**：`object-type-registrar.ts` 读 `ooc.class` 设 parentClass=
  `class:<value>`；删 self.md prototype 读取分支。
  测试：object package.json `ooc.class="supervisor"` → registrar 注册 parentClass="class:supervisor"。

## P1b：五维 class 链回退 + 剔除 prototype（任务级）

- **T8 class 链文件原语**：`builtin-dir.ts` 扩展/新增 `resolveObjectFileDir(ref, fileRel)`——
  own → 沿 ref.class 链（world classes/ 或框架包）→ undefined。executable/visible/readable 读取共用。
  测试：object 无 own self.md/readable，继承 class 的。
- **T9 knowledge loader 改造**：`loader.ts:69` parentClass 现为 `class:<id>`，knowledge 目录
  解析映射到 `classes/<id>/knowledge` 或框架包 knowledge。
  测试：object 无 own knowledge，激活到 class 的 seed knowledge。
- **T10 visible/readable 沿链回退**：`synthesizer.ts:66,171` self window 渲染 + peer windows
  经原语沿 class 链回退 visible renderXml/readable。
  测试：object 无 own visible，渲染用 class 的。
- **T11 剔除 prototype**：删 §5.2 全部触点（object-types.ts / object-type-registrar.ts /
  stone-registry.ts / object-registry.ts / _shared/types/registry.ts / synthesizer.ts:171 /
  cli/init.ts:218→ooc.class）。`check-no-deprecated-symbols.sh` 加 prototype。
  测试：`grep -rn "prototype" packages/@ooc/core --include=*.ts` 仅剩 Object.prototype 等无关项；
  `bun run check:deprecated-symbols` 通过。

## P2：收口（任务级）

- **T12 meta 文档**：`object.doc.ts` 新增 class 一等节点（classes/ 持久化、非交互、单继承、
  两路解析、own-or-inherit、class:<id> 命名空间）；删 prototype 表述 + parent_class_inheritance
  「未统一」旧注。`bun tsc --noEmit packages/@ooc/meta/object.doc.ts` 验证。
- **T13 全 gate**：`bun run verify`（tsc + core 测试 + silent-swallow + deprecated-symbols）全绿。

---

## Self-Review（spec 覆盖核对）
- 动机磁盘 bug → P0 ✓；class 一等化 → T4-T7 ✓；命名空间 C1 → T6 ✓；五维继承 C2 → T8-T10 ✓；
  prototype 剔除 H2 → T11 ✓；meta 文档 → T12 ✓；不改 welcome → 全程未碰 service.ts
  withBuiltinTalkTargets ✓（留 Spec B）。
- 占位符：P0 为完整 TDD；P1/P2 为任务级提纲，执行时按 TDD 细化（已注明）。
- 类型一致：`resolveBuiltinDir`/`resolveObjectFileDir`/`class:<id>` 命名贯穿一致。
