# OOC-4 L3 builtin objects loader Implementation Plan（v2 — src/extendable/base 源码方案）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps 用 checkbox（`- [ ]`）。
>
> **执行纪律（OOC harness）**：执行 sub-agent **不要自己 commit / git add**——只写代码 + 跑测试到全绿，Supervisor 整合提交（带 co-author footer）。

> **v2 重写说明**：v1（commit `a55dccfa`）把 8 原型用 `ensureBuiltinObjects` 在启动时写进 world 目录 `stones/_builtin/objects/`。Supervisor 决策纠正：**builtin object 是框架提供的源码，应作为仓库 committed 文件放在 `src/extendable/base/`，不写进用户 world**。本 plan 重构 v1：删世界生成那套、revert live startup、把 L2 `loadObjectRecord` 从 ref-based 泛化为 dir-based、8 原型改为 `src/extendable/base/<proto>/` 源码、loader 经 `import.meta.dir` 读固定 src 路径。**逻辑寻址 URI 保持 `ooc://stones/_builtin/objects/<proto>`**（地址与物理存储解耦，L2 normalizeExtends/canonicalObjectId 全不动）。

**Goal:** 8 个 builtin 原型（root + program/search/file/knowledge/command_exec/skill_index/custom）作为 `src/extendable/base/<proto>/` 仓库源码 + 一个经 `import.meta.dir` 扫描该目录、build 成 L2 `ObjectRegistry` 的 loader。

**Architecture:** builtin 原型是框架提供的**源码**（与 `src/extendable/lark/` 同级的 extendable 集成层；lark 吃外部 SaaS，base 提供 OOC 自身原型库），committed、与 world 运行时数据分离。逻辑寻址仍是 `ooc://stones/_builtin/objects/<proto>`（self.md frontmatter `extends:` 串原型链）。L3 只物化**骨架**（self.md + root 的兜底 readable.md），不转写 behavior（L4），不接活 render/command resolve（L4），不加 HTTP 路由，**不碰 live startup**（项目直接 `bun src/...` 跑，源码即真相，无需 ensure）。

**Tech Stack:** TypeScript / bun runtime；`bun:test`；`import.meta.dir`（bun 原生，定位本模块所在 src 目录）；复用 L2 `src/executable/prototype/`（`loadObjectRecord`(泛化后 dir-based) / `buildObjectRegistry` / `resolveAlongChain` / `builtinProtoId`）。

---

## 设计决策（权威，执行不得偏离）

### D1 builtin 原型 = src/extendable/base/ 源码（非 world 生成）

每原型一个目录 `src/extendable/base/<proto>/`，含 committed 文件：
- `self.md`：frontmatter `extends:`（root=`null`，7 个=`root`）+ 身份正文。
- `readable.md`：仅 root 有（非空兜底文案）；7 个**不建**此文件（缺失 → `has.readable=false` → 沿链兜底到 root，在测试中验证）。
- `executable/` / `client/`：L3 不建（behavior/visible 是 L4/L8）。

### D2 逻辑寻址 URI 不变（地址 ⟂ 存储）

canonical id 仍 `ooc://stones/_builtin/objects/<proto>` = `builtinProtoId(proto)`。`_builtin` 是**逻辑命名空间**，物理由 `src/extendable/base` 背书。L2 的 `normalizeExtends`（`extends: search → ooc://stones/_builtin/objects/search`）/ `builtinProtoId` / `canonicalObjectId` / 其单测**全不动**（Supervisor 已拍板）。program 的 `extends: root` → `normalizeExtends("root")` → `builtinProtoId("root")` === root 记录的 id → 链接成立。

### D3 L2 ObjectRecord 泛化：ref → dir

L2（commit 6dd10cf2）的 `ObjectRecord.ref: StoneObjectRef` 隐含「对象必在 world stones」。base 原型在 src，不在 stones。泛化为 **`dir: string`（对象目录绝对路径）**——world stone 与 src base 都用目录定位：

```ts
export interface ObjectRecord {
  id: string;                 // 逻辑 canonical id（registry 链接 key）
  extends: string | null;     // 规范化父 id；null=终点
  dir: string;                // 对象目录绝对路径（payload 物理位置）
  has: { executable: boolean; readable: boolean; visible: boolean };
}
```

`loadObjectRecord` 签名 `(ref: StoneObjectRef)` → `(dir: string, id: string)`：直接从 `dir` 读 `self.md` 等文件（不再经 persistable 的 ref-based readSelf/readExecutableSource——那些 bake 了 stoneDir）。id 由调用方给（world 对象用 `canonicalObjectId(ref)`，base 用 `builtinProtoId(name)`）。`canonicalObjectId` 保留（L4 world 对象用），只是不再被 loadObjectRecord 内部调用。

> 消费点已核实全在 `src/executable/prototype/` 内（registry/resolve 只用 ObjectRecord 类型；object-record.test/registry.test/resolve.test 的 `rec()` helper 用 `ref:` → 改 `dir:`）。无外部 live-path 消费，重构封闭。

### D4 loader 经 import.meta.dir 读固定 src 路径

`src/extendable/base/index.ts` 导出 `loadBuiltinRegistry(): Promise<ObjectRegistry>`（**无参**——base 是固定源码路径）：`BASE_PROTOTYPES_DIR = import.meta.dir` → readdir 顶层目录 → 仅含 `self.md` 的目录算 Object（跳过 `__tests__` 等）→ `loadObjectRecord(protoDir, builtinProtoId(name))` → `buildObjectRegistry`。项目直接 `bun src/app/server/index.ts` 跑（无 bundling，见 route-audit 子进程 + 启动入口约定），`import.meta.dir` 在运行/测试下都解析到真实 `src/extendable/base`。

### D5 删 v1 世界生成 + revert live startup

- **删**：`src/executable/prototype/builtin-loader.ts` + 其 test、`src/app/server/bootstrap/{builtin-seed,ensure-builtin-objects}.ts` + ensure 的 test。
- **revert 到 L3 前**：`src/app/server/index.ts`（去掉 ensureBuiltinObjects import + main try/catch）、`src/persistable/stone-bootstrap.ts`（去掉 `RESERVED_TOP_LEVEL` 里的 `"_builtin"` + 注释）——v2 不往 world 写 `stones/_builtin/`，迁移隐患不复存在，**live startup 零改动**。
- prototype barrel 去掉 `loadBuiltinRegistry` 导出（移到 base）；barrel test 去掉对应断言。

### D6 base 是被动模块（不进 extendable side-effect barrel）

`src/extendable/index.ts` 现 `import "./lark/index.js"` 是**side-effect window-type 注册**（被 windows/index.ts 拉起）。base **不是** side-effect——它是按需 consumed 的 loader（L4 调 `loadBuiltinRegistry`）。**不加** `import "./base/..."` 到 extendable/index.ts，仅在其注释「当前子目录」补一行 `base/` 说明（discoverability）。

### D7 L3 明确不做（scope 围栏）

不转写 window behavior（L4）；不接活 render/command resolve（L4）；不加 HTTP 路由；不碰 live startup；不写 world。

---

## File Structure

```
src/extendable/base/                       # 新增：OOC builtin 原型源码库
├── index.ts                               # loadBuiltinRegistry（import.meta.dir 扫描本目录）
├── root/self.md                           # extends: null
├── root/readable.md                       # 非空兜底
├── program/self.md                        # extends: root
├── search/self.md                         # extends: root
├── file/self.md                           # extends: root
├── knowledge/self.md                      # extends: root
├── command_exec/self.md                   # extends: root
├── skill_index/self.md                    # extends: root
├── custom/self.md                         # extends: root
└── __tests__/builtin-registry.test.ts     # 8 原型 + 链 + 兜底 resolve

src/executable/prototype/
├── object-record.ts                       # 改：ref→dir，直接读目录
├── index.ts                               # 改：去掉 loadBuiltinRegistry 导出
└── __tests__/{object-record,registry,resolve,index}.test.ts  # 改：ref→dir / 去断言

src/extendable/index.ts                    # 改：注释补 base/ 一行（无 import）

# 删除（v1 世界生成）
src/executable/prototype/builtin-loader.ts (+ __tests__/builtin-loader.test.ts)
src/app/server/bootstrap/builtin-seed.ts
src/app/server/bootstrap/ensure-builtin-objects.ts (+ __tests__/ensure-builtin-objects.test.ts)

# revert 到 L3 前
src/app/server/index.ts                    # 去 ensureBuiltinObjects import + main 调用
src/persistable/stone-bootstrap.ts         # RESERVED_TOP_LEVEL 去 "_builtin"
```

---

## Task 1: 泛化 L2 ObjectRecord（ref → dir）

**Files:**
- Modify: `src/executable/prototype/object-record.ts`（整文件替换）
- Test: `src/executable/prototype/__tests__/object-record.test.ts`（整文件替换）

- [ ] **Step 1: 改写 object-record.ts**

整文件替换为：

```ts
// src/executable/prototype/object-record.ts
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseSelfMeta } from "./self-meta";

/** 原型链 registry 的链节点。 */
export interface ObjectRecord {
  /** 逻辑 canonical id（如 ooc://stones/_builtin/objects/search），registry 链接 key。 */
  id: string;
  /** 规范化父节点 canonical id；null = 链终点。 */
  extends: string | null;
  /** 对象目录绝对路径（payload 物理位置；world stone 或 src/extendable/base 皆可）。 */
  dir: string;
  /** slot 存在性（内容非空才算存在；空占位/缺失 ≡ false）。 */
  has: { executable: boolean; readable: boolean; visible: boolean };
}

// 对象目录内的相对文件布局（与 persistable stone 布局对齐；这里独立列出，
// 因 ObjectRecord 现在按任意目录加载，不限 world stones）。
const SELF_FILE = "self.md";
const READABLE_FILE = "readable.md";
const EXECUTABLE_FILE = join("executable", "index.ts");
const VISIBLE_FILE = join("client", "index.tsx");

/** 内容非空判定：空字符串 / undefined / 纯空白 ≡ 缺失。 */
function nonEmpty(s: string | undefined): boolean {
  return (s ?? "").trim().length > 0;
}

async function readFileOrUndefined(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

/**
 * 从对象目录 dir 读 self.md → 解析 extends → 探测 slot 存在性，组装 ObjectRecord。
 *
 * id 由调用方提供（逻辑寻址与物理目录解耦）：world 对象用 canonicalObjectId(ref)，
 * base 原型用 builtinProtoId(name)。
 *
 * - self.md 缺失 = 该目录不是一个 Object → 抛错（fail-loud）。空 self.md 合法（默认 extends root）。
 * - slot 按"内容非空"判定（空占位/缺失 ≡ 缺失）。readable.ts 动态 readable L2/L3 不探测。
 */
export async function loadObjectRecord(dir: string, id: string): Promise<ObjectRecord> {
  const selfText = await readFileOrUndefined(join(dir, SELF_FILE));
  if (selfText === undefined) {
    throw new Error(`loadObjectRecord: self.md 不存在于 ${dir}，不是一个 Object`);
  }
  const meta = parseSelfMeta(selfText);
  const [exe, rdb, vis] = await Promise.all([
    readFileOrUndefined(join(dir, EXECUTABLE_FILE)),
    readFileOrUndefined(join(dir, READABLE_FILE)),
    readFileOrUndefined(join(dir, VISIBLE_FILE)),
  ]);
  return {
    id,
    extends: meta.extends,
    dir,
    has: { executable: nonEmpty(exe), readable: nonEmpty(rdb), visible: nonEmpty(vis) },
  };
}
```

- [ ] **Step 2: 改写 object-record.test.ts**

整文件替换为（用 mkdtemp + 直接写文件，不再依赖 createStoneObject/stoneDir）：

```ts
// src/executable/prototype/__tests__/object-record.test.ts
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, test } from "bun:test";
import { loadObjectRecord } from "../object-record";

const dirs: string[] = [];
async function tmpObjectDir(): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), "ooc-rec-"));
  dirs.push(d);
  return d;
}
afterEach(async () => {
  while (dirs.length) await rm(dirs.pop()!, { recursive: true, force: true });
});

describe("loadObjectRecord", () => {
  test("default extends is root when self.md has no frontmatter; absent slots are false", async () => {
    const dir = await tmpObjectDir();
    await writeFile(join(dir, "self.md"), "# x\nplain identity", "utf8");
    const rec = await loadObjectRecord(dir, "ooc://test/x");
    expect(rec.id).toBe("ooc://test/x");
    expect(rec.dir).toBe(dir);
    expect(rec.extends).toBe("ooc://stones/_builtin/objects/root");
    expect(rec.has.executable).toBe(false);
    expect(rec.has.readable).toBe(false);
    expect(rec.has.visible).toBe(false);
  });

  test("parses extends frontmatter and detects executable by non-empty content", async () => {
    const dir = await tmpObjectDir();
    await writeFile(join(dir, "self.md"), "---\nextends: search\n---\nidentity body", "utf8");
    await mkdir(join(dir, "executable"), { recursive: true });
    await writeFile(join(dir, "executable", "index.ts"), "export const window = { commands: {} };", "utf8");
    const rec = await loadObjectRecord(dir, "ooc://test/y");
    expect(rec.extends).toBe("ooc://stones/_builtin/objects/search");
    expect(rec.has.executable).toBe(true);
    expect(rec.has.readable).toBe(false);
  });

  test("detects readable presence when readable.md non-empty; empty/whitespace ≡ absent", async () => {
    const dir = await tmpObjectDir();
    await writeFile(join(dir, "self.md"), "# z", "utf8");
    await writeFile(join(dir, "readable.md"), "I am z, here for others to read.", "utf8");
    expect((await loadObjectRecord(dir, "ooc://test/z")).has.readable).toBe(true);

    // 空白 readable.md ≡ 缺失
    await writeFile(join(dir, "readable.md"), "   \n  ", "utf8");
    expect((await loadObjectRecord(dir, "ooc://test/z")).has.readable).toBe(false);
  });

  test("throws when self.md is missing (not an object)", async () => {
    const dir = await tmpObjectDir();
    await expect(loadObjectRecord(dir, "ooc://test/none")).rejects.toThrow(/self\.md/);
  });
});
```

- [ ] **Step 3: Run object-record test**

Run: `bun test src/executable/prototype/__tests__/object-record.test.ts`
Expected: PASS（4 tests）

---

## Task 2: 修 registry.test / resolve.test 的 rec() helper（ref → dir）

**Files:**
- Modify: `src/executable/prototype/__tests__/registry.test.ts`
- Modify: `src/executable/prototype/__tests__/resolve.test.ts`

- [ ] **Step 1: registry.test.ts 的 rec() helper**

把现有：

```ts
function rec(id: string, ext: string | null): ObjectRecord {
  return {
    id,
    extends: ext,
    ref: { baseDir: "/x", objectId: id, stonesBranch: "main" },
    has: { executable: false, readable: false, visible: false },
  };
}
```

改为：

```ts
function rec(id: string, ext: string | null): ObjectRecord {
  return {
    id,
    extends: ext,
    dir: `/x/${id}`,
    has: { executable: false, readable: false, visible: false },
  };
}
```

- [ ] **Step 2: resolve.test.ts 的 rec() helper**

把现有：

```ts
function rec(id: string, ext: string | null, has: Partial<ObjectRecord["has"]> = {}): ObjectRecord {
  return {
    id,
    extends: ext,
    ref: { baseDir: "/x", objectId: id, stonesBranch: "main" },
    has: { executable: false, readable: false, visible: false, ...has },
  };
}
```

改为：

```ts
function rec(id: string, ext: string | null, has: Partial<ObjectRecord["has"]> = {}): ObjectRecord {
  return {
    id,
    extends: ext,
    dir: `/x/${id}`,
    has: { executable: false, readable: false, visible: false, ...has },
  };
}
```

- [ ] **Step 3: Run both**

Run: `bun test src/executable/prototype/__tests__/registry.test.ts src/executable/prototype/__tests__/resolve.test.ts`
Expected: PASS（registry 8 + resolve 6）

---

## Task 3: 删 v1 世界生成文件 + 改 prototype barrel

**Files:**
- Delete: `src/executable/prototype/builtin-loader.ts`
- Delete: `src/executable/prototype/__tests__/builtin-loader.test.ts`
- Delete: `src/app/server/bootstrap/builtin-seed.ts`
- Delete: `src/app/server/bootstrap/ensure-builtin-objects.ts`
- Delete: `src/app/server/bootstrap/__tests__/ensure-builtin-objects.test.ts`
- Modify: `src/executable/prototype/index.ts`
- Modify: `src/executable/prototype/__tests__/index.test.ts`

- [ ] **Step 1: 删 5 个 v1 文件**

```bash
rm src/executable/prototype/builtin-loader.ts
rm src/executable/prototype/__tests__/builtin-loader.test.ts
rm src/app/server/bootstrap/builtin-seed.ts
rm src/app/server/bootstrap/ensure-builtin-objects.ts
rm src/app/server/bootstrap/__tests__/ensure-builtin-objects.test.ts
```

- [ ] **Step 2: prototype/index.ts 去掉 loadBuiltinRegistry 导出**

删除这一行（v1 加的）：

```ts
export { loadBuiltinRegistry } from "./builtin-loader";
```

barrel 应剩（loadObjectRecord 签名虽变，导出名不变）：

```ts
export { BUILTIN_PROTO_PREFIX, BUILTIN_BRANCH, builtinProtoId, canonicalObjectId } from "./constants";
export { parseSelfMeta, normalizeExtends, type SelfMeta } from "./self-meta";
export { loadObjectRecord, type ObjectRecord } from "./object-record";
export { buildObjectRegistry, type ObjectRegistry } from "./registry";
export { resolveAlongChain, type Probe } from "./resolve";
```

- [ ] **Step 3: index.test.ts 去掉 loadBuiltinRegistry 断言**

删除 v1 加的这一行：

```ts
    expect(typeof proto.loadBuiltinRegistry).toBe("function");
```

（`loadObjectRecord` 等其余断言保留。）

- [ ] **Step 4: 跑 prototype 模块确认无残引**

Run: `bun test src/executable/prototype/`
Expected: PASS（constants 5 + self-meta 7 + object-record 4 + registry 8 + resolve 6 + index 1）。无 `Cannot find module ./builtin-loader`。

---

## Task 4: revert live startup 改动到 L3 前

**Files:**
- Modify: `src/app/server/index.ts`
- Modify: `src/persistable/stone-bootstrap.ts`

- [ ] **Step 1: index.ts 去掉 ensureBuiltinObjects import**

删除 v1 加的 import 行：

```ts
import { ensureBuiltinObjects } from "./bootstrap/ensure-builtin-objects";
```

- [ ] **Step 2: index.ts 去掉 main 里的 ensureBuiltinObjects try/catch 块**

删除 v1 在 `ensureUserObject` catch 块之后、`runRecoveryCheck` 注释之前插入的整段：

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

删除后，`ensureUserObject` catch 块 `}` 与 `// U8: Recovery 自检...` 注释直接相邻（= L3 前原状）。

- [ ] **Step 3: stone-bootstrap.ts RESERVED_TOP_LEVEL 去 "_builtin"**

把 v1 改成的：

```ts
// "_builtin" = OOC-4 builtin 原型伪分支（stones/_builtin/objects/<proto>，见
// src/executable/prototype/constants.ts BUILTIN_BRANCH）。是 world-level 伪分支，
// 与 main 平级，migrateFlatToMain 永不应把它扫进 main/objects/（防 main 被手删的边界）。
const RESERVED_TOP_LEVEL = new Set([STONES_MAIN_BRANCH, STONES_BARE_REPO_DIR, "_builtin", ".git", ".gitignore"]);
```

revert 回 L3 前原状：

```ts
/** 保留目录名，迁移时不会被搬到 main/ 下。 */
const RESERVED_TOP_LEVEL = new Set([STONES_MAIN_BRANCH, STONES_BARE_REPO_DIR, ".git", ".gitignore"]);
```

> v2 不写 `stones/_builtin/` 到 world，故无需此防御。

- [ ] **Step 4: tsc + 启动相关测试不破**

Run: `bun tsc --noEmit 2>&1 | grep -E "error TS"; echo done`
Expected: 0 error（#1 已清 pre-existing 2 个；本步确认 revert 后无新 error）。

---

## Task 5: 创建 8 原型源码骨架 + base loader

**Files:**
- Create: `src/extendable/base/<proto>/self.md` × 8 + `root/readable.md`
- Create: `src/extendable/base/index.ts`
- Test: `src/extendable/base/__tests__/builtin-registry.test.ts`

- [ ] **Step 1: 写 8 个 self.md（+ root readable.md）**

`src/extendable/base/root/self.md`：

```markdown
---
extends: null
---
OOC-4 root 原型：所有 Object 的原型链终点。方法 / visible / readable 沿 extends 链向上找不到时由 root 兜底。
```

`src/extendable/base/root/readable.md`：

```markdown
root 原型（OOC-4 prototype chain 兜底）。任何未自定义对外展示的 Object 最终落到这里。
```

其余 7 个 `src/extendable/base/<proto>/self.md`（`<proto>` ∈ program/search/file/knowledge/command_exec/skill_index/custom），各自：

```markdown
---
extends: root
---
OOC-4 <proto> 原型：A 类实体。behavior（executable commands / 真实 readable / visible）由 L4 转写自 windows/<proto>。
```

（把 `<proto>` 换成实际名；例如 program 的正文写「OOC-4 program 原型：A 类实体。behavior 由 L4 转写自 windows/program。」）

- [ ] **Step 2: 写 base loader（先写测试 Step 3，再回填本实现——TDD）**

`src/extendable/base/index.ts`：

```ts
/**
 * src/extendable/base — OOC-4 builtin 原型的源码实现（框架提供，非 world 生成）。
 *
 * 8 个原型（root + program/search/file/knowledge/command_exec/skill_index/custom）各是本目录下
 * 一个对象目录（<proto>/self.md + 可选 readable.md/executable/visible），committed 源码，与 world
 * 运行时数据分离。逻辑寻址仍是 ooc://stones/_builtin/objects/<proto>（地址 ⟂ 物理存储），
 * 由 self.md frontmatter extends 串成原型链。
 *
 * 与 lark/ 同级：lark 吃外部 SaaS；base 提供 OOC 自身原型库。被动模块（非 side-effect 注册），
 * 由消费方（L4 接活 resolve）直接 import loadBuiltinRegistry。
 */
import { readdir, stat } from "node:fs/promises";
import type { Dirent } from "node:fs";
import { join } from "node:path";
import {
  builtinProtoId,
  loadObjectRecord,
  buildObjectRegistry,
  type ObjectRegistry,
  type ObjectRecord,
} from "../../executable/prototype";

/** base 原型目录绝对路径（= 本模块所在目录）。项目直接 bun src/ 跑，import.meta.dir 可靠。 */
export const BASE_PROTOTYPES_DIR = import.meta.dir;

async function hasSelfMd(dir: string): Promise<boolean> {
  try {
    await stat(join(dir, "self.md"));
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

/**
 * 扫描 src/extendable/base/ 下全部含 self.md 的原型目录，loadObjectRecord 每个
 * （id = builtinProtoId(<dirname>)，逻辑寻址保持 ooc://stones/_builtin/objects/<proto>），
 * build 成 L2 registry（含拓扑校验）。
 */
export async function loadBuiltinRegistry(): Promise<ObjectRegistry> {
  const entries = (await readdir(BASE_PROTOTYPES_DIR, { withFileTypes: true })) as Dirent[];
  const dirs = entries.filter((e) => e.isDirectory() && !e.name.startsWith("."));
  const records: ObjectRecord[] = [];
  for (const d of dirs) {
    const dir = join(BASE_PROTOTYPES_DIR, d.name);
    if (!(await hasSelfMd(dir))) continue; // 跳过 __tests__ 等非 Object 目录
    records.push(await loadObjectRecord(dir, builtinProtoId(d.name)));
  }
  return buildObjectRegistry(records);
}
```

> `as Dirent[]` cast 必须保留（本仓库 tsconfig 下 withFileTypes 解析成 Buffer 重载；precedent: `src/app/server/modules/ui/service.ts:88`）。

- [ ] **Step 3: 写测试（在 Step 2 之前——TDD：先 RED）**

`src/extendable/base/__tests__/builtin-registry.test.ts`：

```ts
import { describe, expect, test } from "bun:test";
import { loadBuiltinRegistry } from "../index";
import { builtinProtoId, resolveAlongChain } from "../../../executable/prototype";

describe("loadBuiltinRegistry (src/extendable/base)", () => {
  test("scans the 8 source prototypes into a registry", async () => {
    const reg = await loadBuiltinRegistry();
    expect(reg.ids().length).toBe(8);
    for (const p of ["root", "program", "search", "file", "knowledge", "command_exec", "skill_index", "custom"]) {
      expect(reg.has(builtinProtoId(p))).toBe(true);
    }
  });

  test("root is chain terminus; non-root protos extend root", async () => {
    const reg = await loadBuiltinRegistry();
    expect(reg.get(builtinProtoId("root"))?.extends).toBeNull();
    expect(reg.get(builtinProtoId("search"))?.extends).toBe(builtinProtoId("root"));
    expect(reg.get(builtinProtoId("custom"))?.extends).toBe(builtinProtoId("root"));
  });

  test("readable resolves up the chain to root for a non-root proto (L2+L3)", async () => {
    const reg = await loadBuiltinRegistry();
    // program 无自己的 readable.md → 沿 extends 兜底到 root（root.has.readable=true）
    const hit = resolveAlongChain(reg, builtinProtoId("program"), (rec) =>
      rec.has.readable ? rec.id : undefined,
    );
    expect(hit?.record.id).toBe(builtinProtoId("root"));
  });

  test("record.dir points at the source proto directory", async () => {
    const reg = await loadBuiltinRegistry();
    expect(reg.get(builtinProtoId("root"))?.dir).toContain("extendable/base/root");
  });
});
```

- [ ] **Step 4: TDD 顺序执行**

先建 8 个 .md（Step 1）+ 测试（Step 3），跑 → FAIL（`Cannot find module ../index`）。
再写 index.ts（Step 2），跑：

Run: `bun test src/extendable/base/`
Expected: PASS（4 tests）

---

## Task 6: extendable barrel 注释补 base/（discoverability）

**Files:**
- Modify: `src/extendable/index.ts`

- [ ] **Step 1: 注释「当前子目录」补一行**

在 `src/extendable/index.ts` 的 `当前子目录：` 注释块里，`- lark/ ...` 之后加：

```
 * - base/    OOC-4 builtin 原型库（root + 7 A 类）；被动模块，loadBuiltinRegistry 按需 consumed，非 side-effect 注册
```

**不**加 `import "./base/index.js"`（base 非 side-effect 注册）。

- [ ] **Step 2: 确认 extendable 仍正常**

Run: `bun test src/extendable/`
Expected: PASS（base 4；lark 无单测，故只跑 base 4）。

---

## Task 7: 全量回归（Supervisor 整合阶段执行）

- [ ] **Step 1: prototype + base 模块全绿**

Run: `bun test src/executable/prototype/ src/extendable/base/`
Expected: 全 PASS（prototype 31 + base 4 = 35）。

- [ ] **Step 2: src 全量回归**

Run: `bun test src/`
Expected: 0 fail，3 skip。计数从**当前 L3/v1 状态基线 1056 pass**起算（v1 commit a55dccfa 已在 HEAD）：`1056 − 3（删 ensure-builtin-objects.test）− 4（删 builtin-loader.test）+ 4（base）= 1053 pass`（object-record.test 替换净 0）。**关键 gate：0 fail；无既有测试转红。**

- [ ] **Step 3: tsc 全量**

Run: `bun tsc --noEmit 2>&1 | grep -E "error TS"; echo done`
Expected: **0 error**（#1 已清 pre-existing；本层不引入新 error）。

- [ ] **Step 4: live startup 已恢复零改动（验证 revert 干净）**

Run: `RUN_BACKEND_E2E=1 NO_PROXY=localhost,127.0.0.1,::1 bun test tests/e2e/backend/route-audit.e2e.test.ts`
Expected: PASS。确认 revert 后 server 真子进程启动正常、无新增 404。

- [ ] **Step 5: scope 围栏**

Run: `git status --short`
Expected: 新增 `src/extendable/base/**`；改 `src/executable/prototype/{object-record.ts,index.ts,__tests__/{object-record,registry,resolve,index}.test.ts}`、`src/extendable/index.ts`；删 v1 的 5 文件；revert `src/app/server/index.ts` + `src/persistable/stone-bootstrap.ts`（diff 相对 a55dccfa 显示移除）；+ plan + meta。**live startup（index.ts main）净效果 = 回到 L3 前**。

---

## 验证 gate 总览（对齐 spec §9 L3「8 原型加载」）

- [ ] 8 原型作 src/extendable/base/ 源码物化，loader 扫描成 registry（8 records，拓扑无环/无悬空）— `builtin-registry.test.ts`。
- [ ] root extends null（终点）；7 个 extends root — 同上。
- [ ] readable 沿链兜底到 root（L2+L3 串联）— 同上。
- [ ] ObjectRecord dir 泛化正确，loadObjectRecord(dir,id) 直接读目录 — `object-record.test.ts`。
- [ ] world 生成那套已删 / live startup 已 revert 零改动 — git diff + route-audit。
- [ ] src 全量 0 fail + tsc 0 error。

不测（YAGNI）：override builtin（不支持）；_builtin 进 world/git（不进）；behavior resolve（L4）。

---

## meta 文档更新

L3(v2) 落地后更新 `meta/object.doc.ts:root.patches.ooc4_object_model.children.prototype_chain.todo` 的 L3 条：把「物化 stones/_builtin/objects/ ... 挂 live startup invariant 覆盖式重生」改为：

> L3 已落地: 8 builtin 原型作 src/extendable/base/<proto>/ 仓库源码（root extends:null + 7 A 类 extends:root；逻辑寻址仍 ooc://stones/_builtin/objects/<p>，地址⟂存储）+ loadBuiltinRegistry(src/extendable/base/index.ts) 经 import.meta.dir 扫描入 L2 registry。**不写 world、不碰 live startup**。L2 ObjectRecord 由 ref 泛化为 dir。behavior 转写 + 接活 resolve 待 L4。

改完立刻 `bun tsc --noEmit meta/object.doc.ts`。本步在 Task 7 Step 5 之后跑。

> 无新增 HTTP 路由 → 不改 route-audit RouteCase（仅借它验证 revert 后 live 启动）。
