# OOC-4 L2 原型链（prototype chain）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **执行纪律（OOC harness）**：执行 sub-agent **不要自己 commit**——只写代码 + 跑测试到全绿，由 Supervisor 整合后统一 commit（带 co-author footer）。因此本 plan 各 Task 末尾的"验证"步骤是跑测试，不是 git commit。

**Goal:** 在 ooc-2 现有代码上增量实装「原型链」——self.md frontmatter `extends:` 解析 + ObjectRecord registry（拓扑环检测 + 悬空拒载）+ 一套沿 `extends` 链的通用 resolve（own 优先 → 沿链向上 → 终点兜底），方法/visible/readable 三者共用同一 walk。

**Architecture:** L2 是 **standalone 引擎**，新建 `src/executable/prototype/` 模块，与现有 `windows/_shared/registry.ts`（per-window-type）**并存不替换**。不接活 render/command 路径——真正接入等 L3 builtin 原型物化。registry build 接受一组 `ObjectRecord`（与"如何从磁盘发现"解耦，发现逻辑是 L3 的事），build 时做拓扑校验。resolve 是 slot-agnostic 的通用 walk：`resolveAlongChain(registry, startId, probe)`，三个消费方（method/visible/readable）只是传不同 probe——L2 用合成 probe 单测证明"一套 walk 服务三种形态"，真实 payload 加载在 L3+ 接入。

**Tech Stack:** TypeScript / bun runtime；`bun:test`；frontmatter 用 `js-yaml`（复用 `src/thinkable/knowledge/parser.ts` 模式）；持久层 helper 复用 `src/persistable`（`readSelf` / `createStoneObject` / `readExecutableSource` / `readReadable` / `readStoneClientSource`）。

---

## 设计决策（权威，执行不得偏离）

锚定伞 spec §3 + 宪法 `object.doc.ts:root.patches.ooc4_object_model.children.prototype_chain`。

### D1 canonical id 方案（链节点 key）

registry 用**规范化字符串 key** 链接 `extends` → 父节点。canonical id 形态：

- builtin 原型（物理 `stones/_builtin/objects/<proto>`，即 `ref.stonesBranch === "_builtin"`）：`ooc://stones/_builtin/objects/<proto>`
- branch 内对象（普通 `ref`）：`ooc://stones/<branch>/objects/<objectId>`（branch 缺省 `main`）

> 注：此 URI 形态是 server 侧原型寻址，与 web 的 `ooc://client/...`（`web/src/shared/ui/oocUri.ts`）是**不同命名空间**，互不复用。spec 此前未钉死 branch 对象 URI 形态，本 plan 钉定为 `ooc://stones/<branch>/objects/<id>`。

### D2 extends 解析与规范化

self.md 顶部可选 YAML frontmatter `extends:`：

| frontmatter | 含义 | 规范化结果 |
|---|---|---|
| 省略（无 `extends` key） | 默认继承 root | `ooc://stones/_builtin/objects/root` |
| `extends: null`（YAML null） | 链终点（仅 root 应这样写） | `null` |
| `extends: search`（裸 token，不含 `://`） | builtin 原型简写 | `ooc://stones/_builtin/objects/search` |
| `extends: ooc://stones/<branch>/objects/<id>`（含 `://`） | branch 内对象做原型 | 原样 verbatim |

规则函数 `normalizeExtends(raw: string): string`：含 `"://"` → 原样返回；否则 → `` `${BUILTIN_PROTO_PREFIX}${raw}` ``。`null`/省略在 `loadObjectRecord` 层处理（不进 `normalizeExtends`）。

### D3 ObjectRecord 形态

```ts
export interface ObjectRecord {
  /** D1 canonical id，registry 的链节点 key。 */
  id: string;
  /** 规范化后的父节点 canonical id；null = 链终点。 */
  extends: string | null;
  /** 回指物理位置，供 L3+ probe lazy 读 payload（executable/readable/visible）。 */
  ref: StoneObjectRef;
  /** slot 存在性（probe 写起来用得到；L2 已可由 fs stat 得出）。 */
  has: { executable: boolean; readable: boolean; visible: boolean };
}
```

### D4 registry build 校验（fail-loud）

`buildObjectRegistry(records: ObjectRecord[])`：

1. **重复 id 校验**：同一 canonical id 出现两次 → 抛错（拒载）。
2. **悬空校验**：任何非 null `extends` 必须在 records 集合里存在对应 id，否则抛错（catch 拼写错）。
3. **环检测**：对整张有向图拓扑校验，发现环抛错拒载（spec §3.1）。
4. 返回**不可变** registry 快照（`Object.freeze` / readonly Map 封装）。

### D5 通用 resolve（一套 walk 三 probe）

```ts
export type Probe<T> = (record: ObjectRecord) => T | undefined;

export function resolveAlongChain<T>(
  registry: ObjectRegistry,
  startId: string,
  probe: Probe<T>,
): { record: ObjectRecord; value: T } | undefined;
```

语义：own（startId 对应 record）先 probe → 命中返回 `{record, value}`；miss → 沿 `extends` 取父 record → probe → …；直到 `extends === null`（终点）仍 miss → 返回 `undefined`。带 `visited` set 二次防环（registry 已校验，这里是 defense-in-depth；若 walk 中遇已访问 id 抛错）。startId 不在 registry → 抛错（fail-loud）。

"root 兜底"= walk 自然走到 root 节点；L2 standalone 单测里 fixture 自造一个 `extends:null` 的 root record 来验证终结与兜底。

### D6 L2 明确不做（scope 围栏）

不接活 render/command 路径、不物化 builtin 原型（L3）、不写 `readable.ts` 动态函数（L1 后半）、不改 `getWindowTypeDefinition` 现有消费点、不碰 visible 真实渲染（L8）、不提供加载真实 payload 的 `resolveMethod`/`resolveReadable`/`resolveVisible`（这些 probe 在 L3+ 接活路径时写；L2 只交付 slot-agnostic 的 `resolveAlongChain` + 合成 probe 单测证明三者共用）。

---

## File Structure

```
src/executable/prototype/
├── constants.ts          # BUILTIN_PROTO_PREFIX 等常量 + canonicalObjectId(ref)
├── self-meta.ts          # parseSelfMeta(text) + normalizeExtends(raw)
├── object-record.ts      # ObjectRecord 类型 + loadObjectRecord(ref)
├── registry.ts           # ObjectRegistry 类型 + buildObjectRegistry(records)
├── resolve.ts            # resolveAlongChain(registry, startId, probe)
├── index.ts              # 模块对外 re-export
└── __tests__/
    ├── constants.test.ts
    ├── self-meta.test.ts
    ├── object-record.test.ts
    ├── registry.test.ts
    ├── resolve.test.ts
    └── index.test.ts
```

每文件单一职责、<200 行。`constants.ts` 把 URI 前缀集中，避免散落字符串。

---

## Task 1: constants — canonical id 与 builtin 前缀

**Files:**
- Create: `src/executable/prototype/constants.ts`
- Test: `src/executable/prototype/__tests__/constants.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/executable/prototype/__tests__/constants.test.ts
import { describe, expect, test } from "bun:test";
import { BUILTIN_PROTO_PREFIX, builtinProtoId, canonicalObjectId } from "../constants";
import type { StoneObjectRef } from "../../../persistable";

describe("constants", () => {
  test("BUILTIN_PROTO_PREFIX is the _builtin objects URI prefix", () => {
    expect(BUILTIN_PROTO_PREFIX).toBe("ooc://stones/_builtin/objects/");
  });

  test("builtinProtoId composes the builtin URI", () => {
    expect(builtinProtoId("search")).toBe("ooc://stones/_builtin/objects/search");
  });

  test("canonicalObjectId for a _builtin ref uses builtin prefix", () => {
    const ref: StoneObjectRef = { baseDir: "/x", objectId: "root", stonesBranch: "_builtin" };
    expect(canonicalObjectId(ref)).toBe("ooc://stones/_builtin/objects/root");
  });

  test("canonicalObjectId for a branch ref uses branch URI", () => {
    const ref: StoneObjectRef = { baseDir: "/x", objectId: "supervisor", stonesBranch: "ooc-4" };
    expect(canonicalObjectId(ref)).toBe("ooc://stones/ooc-4/objects/supervisor");
  });

  test("canonicalObjectId defaults missing branch to main", () => {
    const ref: StoneObjectRef = { baseDir: "/x", objectId: "a" };
    expect(canonicalObjectId(ref)).toBe("ooc://stones/main/objects/a");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/executable/prototype/__tests__/constants.test.ts`
Expected: FAIL（`Cannot find module "../constants"`）

- [ ] **Step 3: Write minimal implementation**

```ts
// src/executable/prototype/constants.ts
import { STONES_MAIN_BRANCH } from "../../persistable";
import type { StoneObjectRef } from "../../persistable";

/** _builtin 原型对象的 canonical URI 前缀（D1）。 */
export const BUILTIN_PROTO_PREFIX = "ooc://stones/_builtin/objects/";

/** _builtin 分支专用名（物理 stones/_builtin/objects/<proto>）。 */
export const BUILTIN_BRANCH = "_builtin";

/** 由原型名拼 builtin canonical id：search → ooc://stones/_builtin/objects/search。 */
export function builtinProtoId(proto: string): string {
  return `${BUILTIN_PROTO_PREFIX}${proto}`;
}

/**
 * 由 StoneObjectRef 计算 canonical id（D1）：
 * - _builtin 分支 → ooc://stones/_builtin/objects/<objectId>
 * - 普通 branch  → ooc://stones/<branch>/objects/<objectId>（branch 缺省 main）
 */
export function canonicalObjectId(ref: StoneObjectRef): string {
  const branch = ref.stonesBranch ?? STONES_MAIN_BRANCH;
  return `ooc://stones/${branch}/objects/${ref.objectId}`;
}
```

> 注：`builtinProtoId(p)` 与 `canonicalObjectId({objectId:p, stonesBranch:"_builtin"})` 必须产出同一字符串——单测第 3/4 条已交叉验证。

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/executable/prototype/__tests__/constants.test.ts`
Expected: PASS（5 tests）

---

## Task 2: self-meta — frontmatter 解析与 extends 规范化

**Files:**
- Create: `src/executable/prototype/self-meta.ts`
- Test: `src/executable/prototype/__tests__/self-meta.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/executable/prototype/__tests__/self-meta.test.ts
import { describe, expect, test } from "bun:test";
import { parseSelfMeta, normalizeExtends } from "../self-meta";

describe("normalizeExtends", () => {
  test("bare token → builtin proto URI", () => {
    expect(normalizeExtends("search")).toBe("ooc://stones/_builtin/objects/search");
  });
  test("full ooc:// URI → verbatim", () => {
    expect(normalizeExtends("ooc://stones/ooc-4/objects/foo")).toBe("ooc://stones/ooc-4/objects/foo");
  });
});

describe("parseSelfMeta", () => {
  test("no frontmatter → whole text is body, extends defaults to root", () => {
    const r = parseSelfMeta("# I am an agent\nhello");
    expect(r.body).toBe("# I am an agent\nhello");
    expect(r.extends).toBe("ooc://stones/_builtin/objects/root");
  });

  test("frontmatter with bare extends → normalized builtin URI", () => {
    const r = parseSelfMeta("---\nextends: search\n---\nbody here");
    expect(r.extends).toBe("ooc://stones/_builtin/objects/search");
    expect(r.body).toBe("body here");
  });

  test("frontmatter extends: null → chain terminus (null)", () => {
    const r = parseSelfMeta("---\nextends: null\n---\nI am root");
    expect(r.extends).toBeNull();
    expect(r.body).toBe("I am root");
  });

  test("frontmatter present but no extends key → defaults to root", () => {
    const r = parseSelfMeta("---\ntitle: foo\n---\nbody");
    expect(r.extends).toBe("ooc://stones/_builtin/objects/root");
  });

  test("full ooc:// extends in frontmatter → verbatim", () => {
    const r = parseSelfMeta("---\nextends: ooc://stones/main/objects/base\n---\nx");
    expect(r.extends).toBe("ooc://stones/main/objects/base");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/executable/prototype/__tests__/self-meta.test.ts`
Expected: FAIL（`Cannot find module "../self-meta"`）

- [ ] **Step 3: Write minimal implementation**

```ts
// src/executable/prototype/self-meta.ts
import yaml from "js-yaml";
import { builtinProtoId } from "./constants";

/** self.md 解析结果。 */
export interface SelfMeta {
  /** 规范化后的父节点 canonical id；null = 链终点；缺省 = root。 */
  extends: string | null;
  /** frontmatter 之后的正文（无 frontmatter 时即整篇）。 */
  body: string;
}

/**
 * 把 extends frontmatter 原始值规范化为 canonical id（D2）：
 * - 含 "://" → 视为已规范化的完整 URI，原样返回
 * - 裸 token → builtin 原型简写：ooc://stones/_builtin/objects/<token>
 *
 * 不处理 null/缺省——那由 parseSelfMeta 决定（缺省→root、显式 null→终点）。
 */
export function normalizeExtends(raw: string): string {
  return raw.includes("://") ? raw : builtinProtoId(raw);
}

/**
 * 解析 self.md：拆 frontmatter / body，导出规范化 extends。
 *
 * 边界（对齐 knowledge parser）：
 * - 不以 `---\n` 开头 → 整篇作 body，extends 默认 root。
 * - frontmatter 无 extends key → 默认 root。
 * - extends: null（YAML null）→ 链终点 null。
 * - extends: <string> → normalizeExtends。
 * - yaml 损坏 → 退化为"无 frontmatter"（整篇作 body，默认 root；不静默吞掉非 extends 字段语义）。
 */
export function parseSelfMeta(text: string): SelfMeta {
  const DEFAULT_PARENT = builtinProtoId("root"); // ooc://stones/_builtin/objects/root
  const { frontmatter, body } = splitFrontmatter(text);
  if (frontmatter === undefined) return { extends: DEFAULT_PARENT, body };

  if (!("extends" in frontmatter)) return { extends: DEFAULT_PARENT, body };
  const raw = frontmatter.extends;
  if (raw === null) return { extends: null, body };
  if (typeof raw !== "string") {
    throw new Error(`self.md frontmatter extends 必须是 string 或 null，得到: ${typeof raw}`);
  }
  return { extends: normalizeExtends(raw), body };
}

function splitFrontmatter(text: string): { frontmatter: Record<string, unknown> | undefined; body: string } {
  if (!text.startsWith("---\n")) return { frontmatter: undefined, body: text };
  const end = text.indexOf("\n---\n", 4);
  if (end === -1) return { frontmatter: undefined, body: text };
  const fmText = text.slice(4, end);
  const body = text.slice(end + 5);
  let parsed: unknown;
  try {
    parsed = yaml.load(fmText);
  } catch {
    return { frontmatter: undefined, body: text };
  }
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    return { frontmatter: parsed as Record<string, unknown>, body };
  }
  return { frontmatter: undefined, body: text };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/executable/prototype/__tests__/self-meta.test.ts`
Expected: PASS（7 tests）

---

## Task 3: object-record — 从磁盘加载单个 ObjectRecord

**Files:**
- Create: `src/executable/prototype/object-record.ts`
- Test: `src/executable/prototype/__tests__/object-record.test.ts`

**关键约束（已核对源码，执行不得忽视）**：`createStoneObject(ref)` 会把 `self.md` **和** `readable.md` 都预创建为**空文件**（见 `src/persistable/stone-object.ts:98-99`）。因此：

- slot 存在性**不能用 fileExists**（readable.md 永远存在 → 永远 true，错）。必须用**「内容非空」**判定：空占位 ≡ 缺失（对齐既有 `loadSelfInstructions 视 empty 等价 undefined` 约定）。
- 三个 slot reader 都返回 `string | undefined`、空文件返回 `""`：`readExecutableSource`（`stone-executable.ts:12`）、`readReadable`（`stone-readable.ts:11`）、`readStoneClientSource`（`stone-client.ts:35`）。统一 `nonEmpty(s) = (s ?? "").trim().length > 0`。
- self.md 缺失才算「非 Object」抛错；空 self.md（createStoneObject 刚建）是**合法** Object，默认 `extends: root`。
- readable.ts（动态 readable，L1 后半/L8）此 L2 不探测，只探测 readable.md 内容非空。

persistable export 已确认：`readSelf`/`writeSelf`/`selfFile`✓、`readReadable`/`writeReadable`✓、`readExecutableSource`/`writeExecutableSource`✓、`readStoneClientSource`/`writeStoneClientSource`✓、`createStoneObject`✓。

- [ ] **Step 1: Write the failing test**

```ts
// src/executable/prototype/__tests__/object-record.test.ts
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, test } from "bun:test";
import { rm as rmFile } from "node:fs/promises";
import {
  createStoneObject,
  writeSelf,
  writeExecutableSource,
  writeReadable,
  selfFile,
} from "../../../persistable";
import { loadObjectRecord } from "../object-record";

let tempRoot: string | undefined;
afterEach(async () => {
  if (tempRoot) {
    await rm(tempRoot, { recursive: true, force: true });
    tempRoot = undefined;
  }
});

describe("loadObjectRecord", () => {
  test("default extends is root; empty readable.md placeholder counts as absent", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-proto-"));
    const ref = await createStoneObject({ baseDir: tempRoot, objectId: "x" });
    await writeSelf(ref, "# x\nplain identity");
    const rec = await loadObjectRecord(ref);
    expect(rec.id).toBe("ooc://stones/main/objects/x");
    expect(rec.extends).toBe("ooc://stones/_builtin/objects/root");
    // createStoneObject 预创建空 readable.md → 非空判定下应为 false（空占位 ≡ 缺失）
    expect(rec.has.executable).toBe(false);
    expect(rec.has.readable).toBe(false);
    expect(rec.has.visible).toBe(false);
  });

  test("parses extends frontmatter and detects executable presence by non-empty content", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-proto-"));
    const ref = await createStoneObject({ baseDir: tempRoot, objectId: "y" });
    await writeSelf(ref, "---\nextends: search\n---\nidentity body");
    await writeExecutableSource(ref, `export const window = { commands: {} };`);
    const rec = await loadObjectRecord(ref);
    expect(rec.extends).toBe("ooc://stones/_builtin/objects/search");
    expect(rec.has.executable).toBe(true);
    expect(rec.has.readable).toBe(false);
  });

  test("detects readable presence when readable.md has non-empty content", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-proto-"));
    const ref = await createStoneObject({ baseDir: tempRoot, objectId: "z" });
    await writeSelf(ref, "# z");
    await writeReadable(ref, "I am z, here for others to read.");
    const rec = await loadObjectRecord(ref);
    expect(rec.has.readable).toBe(true);
  });

  test("throws when self.md is missing (not an object)", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-proto-"));
    const ref = await createStoneObject({ baseDir: tempRoot, objectId: "no-self" });
    // createStoneObject 预创建空 self.md → 须先删才能模拟"非 Object"。空 self.md 本身合法。
    await rmFile(selfFile(ref), { force: true });
    await expect(loadObjectRecord(ref)).rejects.toThrow(/self\.md/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/executable/prototype/__tests__/object-record.test.ts`
Expected: FAIL（`Cannot find module "../object-record"`）

- [ ] **Step 3: Write minimal implementation**

```ts
// src/executable/prototype/object-record.ts
import {
  readSelf,
  readExecutableSource,
  readReadable,
  readStoneClientSource,
  type StoneObjectRef,
} from "../../persistable";
import { canonicalObjectId } from "./constants";
import { parseSelfMeta } from "./self-meta";

/** 原型链 registry 的链节点（D3）。 */
export interface ObjectRecord {
  /** canonical id（D1），registry 链接 key。 */
  id: string;
  /** 规范化父节点 canonical id；null = 链终点。 */
  extends: string | null;
  /** 物理位置，供 L3+ probe lazy 读 payload。 */
  ref: StoneObjectRef;
  /** slot 存在性（内容非空才算存在；空占位 ≡ 缺失）。 */
  has: { executable: boolean; readable: boolean; visible: boolean };
}

/** 内容非空判定：空字符串 / undefined / 纯空白 ≡ 缺失。 */
function nonEmpty(s: string | undefined): boolean {
  return (s ?? "").trim().length > 0;
}

/**
 * 从磁盘读 self.md → 解析 extends → 探测 slot 存在性，组装 ObjectRecord。
 *
 * - self.md 缺失 = 该目录不是一个 Object → 抛错（fail-loud）。空 self.md 合法（默认 extends root）。
 * - slot 存在性按"内容非空"判定：createStoneObject 预创建空 self.md / readable.md，
 *   fileExists 会假阳性，故必须读内容。executable/index.ts 与 client/index.tsx 为 lazy 创建。
 * - readable.ts（动态 readable）L2 不探测，待 L1 后半/L8。
 *
 * 该函数是 L3 builtin scanner 的复用单元；L2 仅单测它本身。
 */
export async function loadObjectRecord(ref: StoneObjectRef): Promise<ObjectRecord> {
  const selfText = await readSelf(ref);
  if (selfText === undefined) {
    throw new Error(`loadObjectRecord: self.md 不存在，${ref.objectId} 不是一个 Object`);
  }
  const meta = parseSelfMeta(selfText);
  const [exe, rdb, vis] = await Promise.all([
    readExecutableSource(ref),
    readReadable(ref),
    readStoneClientSource(ref),
  ]);
  return {
    id: canonicalObjectId(ref),
    extends: meta.extends,
    ref,
    has: { executable: nonEmpty(exe), readable: nonEmpty(rdb), visible: nonEmpty(vis) },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/executable/prototype/__tests__/object-record.test.ts`
Expected: PASS（4 tests）

---

## Task 4: registry — build + 拓扑校验（环/悬空/重复拒载）

**Files:**
- Create: `src/executable/prototype/registry.ts`
- Test: `src/executable/prototype/__tests__/registry.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/executable/prototype/__tests__/registry.test.ts
import { describe, expect, test } from "bun:test";
import { buildObjectRegistry } from "../registry";
import type { ObjectRecord } from "../object-record";

function rec(id: string, ext: string | null): ObjectRecord {
  return {
    id,
    extends: ext,
    ref: { baseDir: "/x", objectId: id, stonesBranch: "main" },
    has: { executable: false, readable: false, visible: false },
  };
}

describe("buildObjectRegistry", () => {
  test("builds and resolves get/has", () => {
    const reg = buildObjectRegistry([rec("root", null), rec("a", "root")]);
    expect(reg.has("a")).toBe(true);
    expect(reg.get("a")?.extends).toBe("root");
    expect(reg.get("missing")).toBeUndefined();
  });

  test("rejects duplicate id", () => {
    expect(() => buildObjectRegistry([rec("a", "root"), rec("a", "root"), rec("root", null)]))
      .toThrow(/duplicate|重复/i);
  });

  test("rejects dangling extends (parent not present)", () => {
    expect(() => buildObjectRegistry([rec("a", "ghost")]))
      .toThrow(/dangling|不存在|ghost/i);
  });

  test("rejects self cycle (a → a)", () => {
    expect(() => buildObjectRegistry([rec("a", "a")]))
      .toThrow(/cycle|环/i);
  });

  test("rejects 2-node cycle (a → b → a)", () => {
    expect(() => buildObjectRegistry([rec("a", "b"), rec("b", "a")]))
      .toThrow(/cycle|环/i);
  });

  test("rejects longer cycle (a → b → c → a)", () => {
    expect(() => buildObjectRegistry([rec("a", "b"), rec("b", "c"), rec("c", "a")]))
      .toThrow(/cycle|环/i);
  });

  test("accepts valid DAG with shared ancestor", () => {
    const reg = buildObjectRegistry([
      rec("root", null),
      rec("a", "root"),
      rec("b", "a"),
      rec("c", "a"),
    ]);
    expect(reg.has("b")).toBe(true);
    expect(reg.has("c")).toBe(true);
  });

  test("registry snapshot is immutable", () => {
    const reg = buildObjectRegistry([rec("root", null)]);
    // get 返回的 record 不应能 mutate registry 内部状态
    const r = reg.get("root")!;
    expect(() => { (r as { id: string }).id = "hacked"; }).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/executable/prototype/__tests__/registry.test.ts`
Expected: FAIL（`Cannot find module "../registry"`）

- [ ] **Step 3: Write minimal implementation**

```ts
// src/executable/prototype/registry.ts
import type { ObjectRecord } from "./object-record";

/** 不可变 registry 快照：按 canonical id 索引 ObjectRecord，并已通过拓扑校验。 */
export interface ObjectRegistry {
  get(id: string): ObjectRecord | undefined;
  has(id: string): boolean;
  ids(): string[];
}

/**
 * 由一组 ObjectRecord 构建 registry，build 时做三重 fail-loud 校验（D4）：
 * 1. 重复 id 拒载
 * 2. 悬空 extends（父不存在）拒载
 * 3. 环（拓扑校验）拒载
 *
 * records 如何从磁盘发现与本函数解耦（L3 提供 scanner）。
 */
export function buildObjectRegistry(records: ObjectRecord[]): ObjectRegistry {
  const map = new Map<string, ObjectRecord>();
  for (const r of records) {
    if (map.has(r.id)) {
      throw new Error(`buildObjectRegistry: duplicate object id「${r.id}」（重复 id 拒载）`);
    }
    map.set(r.id, Object.freeze({ ...r, has: Object.freeze({ ...r.has }) }));
  }

  // 悬空校验
  for (const r of map.values()) {
    if (r.extends !== null && !map.has(r.extends)) {
      throw new Error(
        `buildObjectRegistry: dangling extends「${r.extends}」（${r.id} 的父原型不存在；拒载）`,
      );
    }
  }

  // 环检测：沿 extends 单父链 walk，遇重复即环（单父 → 用 path set 即可）
  for (const start of map.keys()) {
    const seen = new Set<string>();
    let cur: string | null = start;
    while (cur !== null) {
      if (seen.has(cur)) {
        throw new Error(
          `buildObjectRegistry: extends 链中检测到环（cycle），起于「${start}」，重复节点「${cur}」（拒载）`,
        );
      }
      seen.add(cur);
      cur = map.get(cur)?.extends ?? null;
    }
  }

  return {
    get: (id) => map.get(id),
    has: (id) => map.has(id),
    ids: () => Array.from(map.keys()),
  };
}
```

> 环检测用单父链 walk（每节点只有一个 `extends`，所以"路径上出现重复 id"即环），不需通用 DFS 三色法——更简单且对单继承充分。悬空校验先于环检测，确保 walk 中 `map.get(cur)` 必有定义（或 null 终点）。

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/executable/prototype/__tests__/registry.test.ts`
Expected: PASS（8 tests）

---

## Task 5: resolve — 通用沿链 walk（一套 walk，三 probe 验证）

**Files:**
- Create: `src/executable/prototype/resolve.ts`
- Test: `src/executable/prototype/__tests__/resolve.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/executable/prototype/__tests__/resolve.test.ts
import { describe, expect, test } from "bun:test";
import { buildObjectRegistry } from "../registry";
import { resolveAlongChain } from "../resolve";
import type { ObjectRecord } from "../object-record";

function rec(id: string, ext: string | null, has: Partial<ObjectRecord["has"]> = {}): ObjectRecord {
  return {
    id,
    extends: ext,
    ref: { baseDir: "/x", objectId: id, stonesBranch: "main" },
    has: { executable: false, readable: false, visible: false, ...has },
  };
}

describe("resolveAlongChain", () => {
  const reg = buildObjectRegistry([
    rec("root", null, { executable: true, readable: true, visible: true }),
    rec("mid", "root", { readable: true }),
    rec("leaf", "mid", { executable: true }),
  ]);

  test("own hit returns the start record", () => {
    const r = resolveAlongChain(reg, "leaf", (rec) => (rec.has.executable ? rec.id : undefined));
    expect(r?.record.id).toBe("leaf");
    expect(r?.value).toBe("leaf");
  });

  test("ancestor hit walks up the chain", () => {
    // leaf 无 readable → mid 有 readable
    const r = resolveAlongChain(reg, "leaf", (rec) => (rec.has.readable ? rec.id : undefined));
    expect(r?.record.id).toBe("mid");
  });

  test("root fallback when only root provides the slot", () => {
    // leaf/mid 都无 visible → root 兜底
    const r = resolveAlongChain(reg, "leaf", (rec) => (rec.has.visible ? rec.id : undefined));
    expect(r?.record.id).toBe("root");
  });

  test("miss all the way → undefined", () => {
    const r = resolveAlongChain(reg, "leaf", () => undefined);
    expect(r).toBeUndefined();
  });

  test("throws when startId not in registry", () => {
    expect(() => resolveAlongChain(reg, "ghost", () => "x")).toThrow(/ghost|not.*registr|不在/i);
  });

  test("same walk serves three different probes (method/visible/readable share)", () => {
    const methodProbe = (rec: ObjectRecord) => (rec.has.executable ? rec.id : undefined);
    const visibleProbe = (rec: ObjectRecord) => (rec.has.visible ? rec.id : undefined);
    const readableProbe = (rec: ObjectRecord) => (rec.has.readable ? rec.id : undefined);
    expect(resolveAlongChain(reg, "leaf", methodProbe)?.record.id).toBe("leaf");
    expect(resolveAlongChain(reg, "leaf", visibleProbe)?.record.id).toBe("root");
    expect(resolveAlongChain(reg, "leaf", readableProbe)?.record.id).toBe("mid");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/executable/prototype/__tests__/resolve.test.ts`
Expected: FAIL（`Cannot find module "../resolve"`）

- [ ] **Step 3: Write minimal implementation**

```ts
// src/executable/prototype/resolve.ts
import type { ObjectRecord } from "./object-record";
import type { ObjectRegistry } from "./registry";

/** probe：给定一个 record，判断它是否提供所求；提供则返回 payload，否则 undefined。 */
export type Probe<T> = (record: ObjectRecord) => T | undefined;

/**
 * 沿 extends 链 resolve（D5）：own 先 probe → 命中即返回；miss 则沿 extends 向上，
 * 直到终点（extends=null）仍 miss 返回 undefined。
 *
 * 方法 / visible / readable 三者共用本 walk，只是传不同 probe。
 *
 * - startId 不在 registry → 抛错（fail-loud）。
 * - visited set 二次防环（registry build 已校验，此处 defense-in-depth）。
 */
export function resolveAlongChain<T>(
  registry: ObjectRegistry,
  startId: string,
  probe: Probe<T>,
): { record: ObjectRecord; value: T } | undefined {
  if (!registry.has(startId)) {
    throw new Error(`resolveAlongChain: startId「${startId}」不在 registry 中（未注册）`);
  }
  const visited = new Set<string>();
  let curId: string | null = startId;
  while (curId !== null) {
    if (visited.has(curId)) {
      throw new Error(`resolveAlongChain: extends 链中遇环，重复节点「${curId}」`);
    }
    visited.add(curId);
    const record = registry.get(curId);
    if (!record) {
      // 悬空——registry build 应已拒载；此处 fail-loud
      throw new Error(`resolveAlongChain: 链节点「${curId}」不在 registry（悬空）`);
    }
    const value = probe(record);
    if (value !== undefined) return { record, value };
    curId = record.extends;
  }
  return undefined;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/executable/prototype/__tests__/resolve.test.ts`
Expected: PASS（6 tests）

---

## Task 6: index — 模块对外 re-export

**Files:**
- Create: `src/executable/prototype/index.ts`
- Test: `src/executable/prototype/__tests__/index.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/executable/prototype/__tests__/index.test.ts
import { describe, expect, test } from "bun:test";
import * as proto from "../index";

describe("prototype barrel", () => {
  test("re-exports all public symbols", () => {
    expect(typeof proto.BUILTIN_PROTO_PREFIX).toBe("string");
    expect(typeof proto.builtinProtoId).toBe("function");
    expect(typeof proto.canonicalObjectId).toBe("function");
    expect(typeof proto.parseSelfMeta).toBe("function");
    expect(typeof proto.normalizeExtends).toBe("function");
    expect(typeof proto.loadObjectRecord).toBe("function");
    expect(typeof proto.buildObjectRegistry).toBe("function");
    expect(typeof proto.resolveAlongChain).toBe("function");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/executable/prototype/__tests__/index.test.ts`
Expected: FAIL（`Cannot find module "../index"`）

- [ ] **Step 3: Write the barrel**

```ts
// src/executable/prototype/index.ts
export { BUILTIN_PROTO_PREFIX, BUILTIN_BRANCH, builtinProtoId, canonicalObjectId } from "./constants";
export { parseSelfMeta, normalizeExtends, type SelfMeta } from "./self-meta";
export { loadObjectRecord, type ObjectRecord } from "./object-record";
export { buildObjectRegistry, type ObjectRegistry } from "./registry";
export { resolveAlongChain, type Probe } from "./resolve";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/executable/prototype/`
Expected: PASS（全模块测试，constants + self-meta + object-record + registry + resolve + index）

---

## Task 7: 全量回归（Supervisor 整合阶段执行）

> 本任务由 Supervisor 在整合时跑，sub-agent 执行完 Task 1-6 后交回。

- [ ] **Step 1: 模块单测全绿**

Run: `bun test src/executable/prototype/`
Expected: 全 PASS（constants 5 + self-meta 7 + object-record 4 + registry 8 + resolve 6 = 30 tests 量级）

- [ ] **Step 2: src 全量回归（基线 1018 pass，不得回退）**

Run: `bun test src/`
Expected: 至少 1018 pass + L2 新增 ~30，0 fail。**若任何既有测试转红 = L2 越界改了活路径，必须排查。**

- [ ] **Step 3: tsc 类型检查**

Run: `bun tsc --noEmit`
Expected: 0 error（确认新模块类型干净，未污染既有类型）

- [ ] **Step 4: 确认未触碰活路径（在 meta 文档更新之前跑）**

Run: `git diff --stat`
Expected: 改动**仅限** `src/executable/prototype/**`（新增）+ 本 plan 文档（+ 稍后的 `meta/object.doc.ts` todo 更新，那是预期白名单）。`windows/_shared/registry.ts`、`server/loader.ts`、render.ts 等**零改动**——验证 D6 scope 围栏。本步在「meta 文档更新」之前执行，避免 object.doc.ts 进 diff 干扰判读。

---

## 验证 gate 总览（对齐 spec §11.1）

- [ ] 原型链 resolve：own 优先、沿链 fallback、终点兜底、miss→undefined — `resolve.test.ts` 覆盖。
- [ ] 环检测拒载：自环 / 2-环 / 长环 — `registry.test.ts` 覆盖。
- [ ] 悬空 extends 拒载、重复 id 拒载 — `registry.test.ts` 覆盖。
- [ ] extends 解析：省略→root / 显式 null→终点 / 裸 token→builtin / 完整 URI→verbatim — `self-meta.test.ts` 覆盖。
- [ ] 三者共用同一 walk — `resolve.test.ts` "same walk serves three probes" 覆盖。
- [ ] src 全量 ≥1018 pass + tsc 0 error。
- [ ] D6 scope 围栏：活路径零改动。

---

## meta 文档更新

L2 落地后，`object.doc.ts:root.patches.ooc4_object_model.children.prototype_chain` 的 `todo` 从「spec L2: …」更新为「L2 已落地（src/executable/prototype/）：standalone 引擎；接活路径待 L3」。改完立刻 `bun tsc --noEmit meta/object.doc.ts`。

> 注：本 plan 不新增任何 HTTP 路由（standalone 引擎，不接活路径），故**无需**改 `tests/e2e/backend/route-audit.e2e.test.ts`。L3 物化 builtin loader 若新增路由，届时补 gate。
