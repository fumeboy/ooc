# 线 B：Window 状态对象 + windowMethods 归 readable 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把控制 window 展示的方法（`set_viewport` 等）从 executable 的 `methods` 分离成 readable 维度的独立 `windowMethods`，并把 window 展示参数收口成一个持久化的 window 状态对象（`window.state`），window method 与 readable 共享它、与 object method（业务数据）彻底分开。

**Architecture:** 新增统一展示状态容器 `WindowDisplayState`（收口 viewport / transcriptViewport / resultsViewport / historyViewport）挂为 window 子字段 `state`，随 `toData()` 持久化到 thread-context。新增 `WindowMethod` 独立类型（exec 额外接收 `windowState`、返回新 state，immutable），`ObjectDefinition.windowMethods` 注册槽，dispatch 在 `WindowManager` 命中 windowMethod 时注入 state 并写回。各 builtin 把展示 method 迁过去、readable 改读 `window.state`（向后兼容旧平铺字段）。

**Tech Stack:** TypeScript / bun runtime / bun:test。无新依赖。

> 设计来源：`docs/2026-06-08-window-visible-render-and-readable-window-method-design.md` Part 2。本计划只覆盖线 B（后端）；线 A（前端统一渲染解析层）是独立 plan。

---

## 文件结构

**新建：**
- `packages/@ooc/core/_shared/types/window-state.ts` — `WindowDisplayState` 类型（展示状态容器）。
- `packages/@ooc/core/_shared/types/window-method.ts` — `WindowMethod` / `WindowMethodExecutionContext` / `WindowMethodOutcome` 类型。
- `packages/@ooc/core/__tests__/window-method-dispatch.test.ts` — dispatch + 状态写回测试。

**修改：**
- `packages/@ooc/core/_shared/types/context-window.ts:98-133` — `BaseContextWindow` 加 `state?`。
- `packages/@ooc/core/_shared/types/registry.ts:57-72` — `ObjectDefinition` 加 `windowMethods?`。
- `packages/@ooc/core/runtime/object-registry.ts` — 三处白名单 + `lookupWindowMethod`/`resolveWindowMethod`。
- `packages/@ooc/core/executable/windows/_shared/manager.ts` — `openMethodExec`/`submit` dispatch 分流。
- `packages/@ooc/core/executable/windows/_shared/viewport.ts` / `transcript-viewport.ts` / `packages/@ooc/builtins/_shared/executable/viewport-adapter.ts` — 执行体改返回新 state。
- 各 builtin `executable/index.ts` + `readable.ts`（file / knowledge / search / program）+ talk/do 的 `command.set-transcript-window.ts` 与 `index.ts` renderXml + 各 `types.ts`。
- `packages/@ooc/meta/object.doc.ts` — readable / executable 概念节点收编。

---

## Task 1: WindowDisplayState 类型 + window.state 字段

**Files:**
- Create: `packages/@ooc/core/_shared/types/window-state.ts`
- Modify: `packages/@ooc/core/_shared/types/context-window.ts:98-133`
- Test: `packages/@ooc/core/__tests__/window-state.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/@ooc/core/__tests__/window-state.test.ts
import { test, expect } from "bun:test";
import type { WindowDisplayState } from "../_shared/types/window-state.js";
import type { BaseContextWindow } from "../_shared/types/context-window.js";

test("WindowDisplayState holds display params only", () => {
  const state: WindowDisplayState = {
    viewport: { lineStart: 0, lineEnd: 100, columnStart: 0, columnEnd: 200 },
  };
  expect(state.viewport?.lineEnd).toBe(100);
});

test("BaseContextWindow carries optional state", () => {
  const w = { id: "x", type: "file", state: { viewport: { lineStart: 0, lineEnd: 10, columnStart: 0, columnEnd: 80 } } } as BaseContextWindow;
  expect((w.state as WindowDisplayState).viewport?.lineEnd).toBe(10);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/@ooc/core/__tests__/window-state.test.ts`
Expected: FAIL — cannot find module `window-state.js` / `state` not on `BaseContextWindow`.

- [ ] **Step 3: Create the type**

```ts
// packages/@ooc/core/_shared/types/window-state.ts
import type { Viewport, TranscriptViewport } from "./viewport.js";

/**
 * Window 展示状态对象 —— 持有一个 window 的展示参数，与 window 业务数据（file path、
 * program history…）分离。由 readable 维度的 WindowMethod 读写、readable 函数读取、
 * 随 window 持久化在 thread-context。每个 window type 只用其中与自己相关的字段。
 */
export interface WindowDisplayState {
  /** file / knowledge：行列视口 */
  viewport?: Viewport;
  /** talk / do：transcript 视口 */
  transcriptViewport?: TranscriptViewport;
  /** search：结果列表视口 */
  resultsViewport?: TranscriptViewport;
  /** program：执行历史视口 */
  historyViewport?: TranscriptViewport;
}
```

- [ ] **Step 4: Add state field to BaseContextWindow**

In `packages/@ooc/core/_shared/types/context-window.ts`, add import at top and field inside `BaseContextWindow` (around :98-133):

```ts
import type { WindowDisplayState } from "./window-state.js";
// ... inside BaseContextWindow interface, add:
  /** P-window-state: 展示状态对象（viewport 等）。与业务数据分离，由 WindowMethod 读写。 */
  state?: WindowDisplayState;
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test packages/@ooc/core/__tests__/window-state.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/@ooc/core/_shared/types/window-state.ts packages/@ooc/core/_shared/types/context-window.ts packages/@ooc/core/__tests__/window-state.test.ts
git commit -m "feat(window-state): WindowDisplayState 类型 + window.state 子字段"
```

---

## Task 2: WindowMethod 类型

**Files:**
- Create: `packages/@ooc/core/_shared/types/window-method.ts`
- Test: `packages/@ooc/core/__tests__/window-method-type.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/@ooc/core/__tests__/window-method-type.test.ts
import { test, expect } from "bun:test";
import type { WindowMethod, WindowMethodOutcome } from "../_shared/types/window-method.js";

test("WindowMethod exec receives windowState and returns new state", async () => {
  const m: WindowMethod = {
    paths: ["set_viewport"],
    intent: () => [],
    exec: (ctx) => ({ ok: true, state: { ...ctx.windowState, viewport: { lineStart: 0, lineEnd: 50, columnStart: 0, columnEnd: 80 } } }),
  };
  const out = (await m.exec({ args: {}, windowState: {} })) as Extract<WindowMethodOutcome, { ok: true }>;
  expect(out.ok).toBe(true);
  expect(out.state.viewport?.lineEnd).toBe(50);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/@ooc/core/__tests__/window-method-type.test.ts`
Expected: FAIL — cannot find module `window-method.js`.

- [ ] **Step 3: Create the type**

```ts
// packages/@ooc/core/_shared/types/window-method.ts
import type { MethodExecutionContext, MethodKnowledgeEntries } from "./method.js";
import type { ContextObject } from "./context-window.js";
import type { Intent, FormChangeEvent, MethodCallSchema } from "./intent.js";
import type { WindowDisplayState } from "./window-state.js";

/**
 * WindowMethod 执行上下文 —— 在 ObjectMethod 入参基础上额外接收 window 展示状态对象。
 * 这是 WindowMethod 与 ObjectMethod 的签名差异点。
 */
export interface WindowMethodExecutionContext extends MethodExecutionContext {
  /** 当前 window 展示状态（只读快照）；method 据此计算新 state 返回。 */
  windowState: WindowDisplayState;
}

/** WindowMethod.exec 的返回结果：成功必带新 state（immutable，由 manager 写回 window.state）。 */
export type WindowMethodOutcome =
  | { ok: true; state: WindowDisplayState; result?: string }
  | { ok: false; error: string };

/**
 * Window method 定义 —— 控制 window 展示（viewport 等），归 readable 维度。
 * 与 ObjectMethod（控制 object 业务数据，归 executable）函数签名不同：
 * exec 额外接收 windowState、返回新 WindowDisplayState 而非原地 mutate。
 */
export interface WindowMethod {
  kind?: "window";
  paths: string[];
  permission?: (args: Record<string, unknown>) => "allow" | "ask" | "deny";
  intent(args: Record<string, unknown>): Intent[];
  onFormChange?(
    change: FormChangeEvent,
    ctx: { form: ContextObject; intents: Intent[] },
  ): ContextObject[];
  schema?: MethodCallSchema;
  /** 不同于 ObjectMethod.exec：额外接收 ctx.windowState，返回新 state。 */
  exec: (
    ctx: WindowMethodExecutionContext,
  ) => WindowMethodOutcome | Promise<WindowMethodOutcome>;
  public?: boolean;
  for_ui_access?: boolean;
}
```

> 注：`MethodKnowledgeEntries` import 仅在需要时保留；若 unused 删除以过 lint。确认 `MethodExecutionContext` / `Intent` / `FormChangeEvent` / `MethodCallSchema` 的导出名与 `method.ts` / `intent.ts` 一致。

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/@ooc/core/__tests__/window-method-type.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/@ooc/core/_shared/types/window-method.ts packages/@ooc/core/__tests__/window-method-type.test.ts
git commit -m "feat(window-method): WindowMethod 独立类型(exec 接收 windowState 返回新 state)"
```

---

## Task 3: ObjectDefinition.windowMethods + registry 白名单 + 查找

**Files:**
- Modify: `packages/@ooc/core/_shared/types/registry.ts:57-72`
- Modify: `packages/@ooc/core/runtime/object-registry.ts`（`registerObjectType` :83-100 / `registerNewObjectType` :102-119 / `seedFrom` :243-265 / 新增 `lookupWindowMethod` 仿 :159-175）
- Test: `packages/@ooc/core/__tests__/window-method-registry.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/@ooc/core/__tests__/window-method-registry.test.ts
import { test, expect } from "bun:test";
import { ObjectRegistry } from "../runtime/object-registry.js";
import type { WindowMethod } from "../_shared/types/window-method.js";

const wm: WindowMethod = { paths: ["set_viewport"], intent: () => [], exec: (ctx) => ({ ok: true, state: ctx.windowState }) };

test("registerObjectType keeps windowMethods", () => {
  const r = new ObjectRegistry();
  r.registerObjectType("file", { type: "file", methods: {}, windowMethods: { set_viewport: wm } });
  expect(r.getObjectDefinition("file")?.windowMethods?.set_viewport).toBeDefined();
});

test("lookupWindowMethod resolves via parentClass chain", () => {
  const r = new ObjectRegistry();
  r.registerObjectType("base_doc", { type: "base_doc", methods: {}, windowMethods: { set_viewport: wm } });
  r.registerObjectType("my_doc", { type: "my_doc", methods: {}, parentClass: "base_doc" });
  expect(r.lookupWindowMethod({ id: "x", type: "my_doc" } as any, "set_viewport")).toBeDefined();
});

test("seedFrom carries windowMethods to per-world registry", () => {
  const src = new ObjectRegistry();
  src.registerObjectType("file", { type: "file", methods: {}, windowMethods: { set_viewport: wm } });
  const world = new ObjectRegistry();
  world.seedFrom(src);
  expect(world.getObjectDefinition("file")?.windowMethods?.set_viewport).toBeDefined();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/@ooc/core/__tests__/window-method-registry.test.ts`
Expected: FAIL — `windowMethods` not on `ObjectDefinition` / `lookupWindowMethod` undefined.

- [ ] **Step 3: Add field to ObjectDefinition**

In `packages/@ooc/core/_shared/types/registry.ts`, add import + field (inside `ObjectDefinition`, :57-72):

```ts
import type { WindowMethod } from "./window-method.js";
// ... inside ObjectDefinition:
  /** Window method 表（归 readable 维度，控制 window 展示）。与 methods（object method,
   *  归 executable）物理分离。dispatch 时优先查此表。 */
  windowMethods?: Record<string, WindowMethod>;
```

- [ ] **Step 4: Wire three registry whitelists + lookup**

In `packages/@ooc/core/runtime/object-registry.ts`:

`registerObjectType` (around :86, where `nextMethods` is merged) — add parallel merge:
```ts
const nextWindowMethods = partial.windowMethods ?? existing?.windowMethods;
// ...include in the stored definition object: windowMethods: nextWindowMethods,
```
`registerNewObjectType` (:102-119) — include `windowMethods: partial.windowMethods` in the new definition.
`seedFrom` (:243-265) — when copying each definition, include `windowMethods: def.windowMethods`.

Add lookup methods (mirror `lookupMethod`/`resolveMethod` :155-190):
```ts
lookupWindowMethod(self: { type: string }, name: string): WindowMethod | undefined {
  return this.resolveWindowMethod(self.type, name);
}
private resolveWindowMethod(type: string, name: string): WindowMethod | undefined {
  const def = this.definitions.get(type);
  const own = def?.windowMethods?.[name];
  if (own) return own;
  for (const ancestor of this.resolveParentClassChain(type)) {
    const inherited = this.definitions.get(ancestor)?.windowMethods?.[name];
    if (inherited) return inherited;
  }
  return undefined;
}
```
> Confirm the private field name holding definitions (e.g. `this.definitions`) and `resolveParentClassChain` signature by reading the file; match existing `resolveMethod` exactly.

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test packages/@ooc/core/__tests__/window-method-registry.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/@ooc/core/_shared/types/registry.ts packages/@ooc/core/runtime/object-registry.ts packages/@ooc/core/__tests__/window-method-registry.test.ts
git commit -m "feat(registry): ObjectDefinition.windowMethods + 三处白名单 + lookupWindowMethod"
```

---

## Task 4: WindowManager dispatch 分流 + state 写回

**Files:**
- Modify: `packages/@ooc/core/executable/windows/_shared/manager.ts`（`openMethodExec` :362-392 lookup；`submit` :637-681 ctx 构造 + 执行）
- Test: `packages/@ooc/core/__tests__/window-method-dispatch.test.ts`

**契约**：dispatch 命中 windowMethod 时——取 `parent.state ?? {}` 作 `windowState` 注入 ctx；执行后把 `outcome.state` 写回 `parent.state`（immutable：upsert 一个 `{ ...parent, state: outcome.state }`）。object method（普通 methods）路径不变。windowMethod 优先于 method 查找；同名禁止（见 Step 4 校验）。

- [ ] **Step 1: Write the failing test**

```ts
// packages/@ooc/core/__tests__/window-method-dispatch.test.ts
import { test, expect } from "bun:test";
import { ObjectRegistry } from "../runtime/object-registry.js";
import { WindowManager } from "../executable/windows/_shared/manager.js";
import type { WindowMethod } from "../_shared/types/window-method.js";

const setViewport: WindowMethod = {
  paths: ["set_viewport"], intent: () => [],
  exec: (ctx) => ({ ok: true, state: { ...ctx.windowState, viewport: { lineStart: 0, lineEnd: Number(ctx.args.line_end ?? 0), columnStart: 0, columnEnd: 80 } } }),
};

test("windowMethod dispatch writes new state back to window", async () => {
  const registry = new ObjectRegistry();
  registry.registerObjectType("file", { type: "file", methods: {}, windowMethods: { set_viewport: setViewport } });
  // 构造一个含 file window 的 thread（参照现有 manager 测试夹具构造方式）
  const thread = makeThreadWithWindow({ id: "f1", type: "file", state: {} });
  const mgr = WindowManager.fromThread(thread, registry);
  await mgr.openMethodExec({ thread, parentWindowId: "f1", command: "set_viewport", title: "set_viewport", args: { line_end: 123 } });
  const data = mgr.toData();
  const w = data.find((x: any) => x.id === "f1") as any;
  expect(w.state.viewport.lineEnd).toBe(123);
});
```
> `makeThreadWithWindow` / `makeThread`：复用现有 manager 测试里构造 thread+window 的 helper（先 grep `WindowManager.fromThread` 的现有测试找夹具；若无，按 `ThreadContext` 最小结构构造 `{ contextWindows: [window], ... }`）。

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/@ooc/core/__tests__/window-method-dispatch.test.ts`
Expected: FAIL — windowMethod 未被识别（lookupMethodEntry 找不到，抛 unregistered），state 未写回。

- [ ] **Step 3: Add windowMethod branch in lookup + submit**

In `openMethodExec` (around :387 where `lookupMethodEntry` runs): before failing on unregistered ObjectMethod, also try window method:
```ts
const windowEntry = this.registry.lookupWindowMethod(parent, opts.command);
// if windowEntry exists, mark the form/branch as window-method (carry a flag, e.g. isWindowMethod: true)
```
In `submit` (around :637-681): branch by kind. Window-method path:
```ts
const windowEntry = this.registry.lookupWindowMethod(parent, form.command);
if (windowEntry) {
  const windowState = (parent as { state?: WindowDisplayState }).state ?? {};
  const ctx: WindowMethodExecutionContext = {
    thread, form: executing, self: parent, manager: this,
    args: form.accumulatedArgs, ownerFlowObjectRef, ownerThreadRef,
    reportStateEdit, reportContextEdit, windowState,
  };
  const outcome = await windowEntry.exec(ctx);
  if (outcome.ok) {
    this.upsertWindow({ ...parent, state: outcome.state });   // immutable 写回
    return { /* success outcome shape matching existing submit return */ result: outcome.result };
  }
  return { /* failure shape */ error: outcome.error };
}
// else: existing ObjectMethod path unchanged (entry.exec(ctx) at :681)
```
> Read `submit`'s existing return shape (:689-710) and `upsertWindow` signature; match exactly. Import `WindowMethodExecutionContext` / `WindowDisplayState`.

- [ ] **Step 4: Add same-name guard**

In `registerObjectType` (object-registry.ts), after merging, throw if a name appears in both `methods` and `windowMethods`:
```ts
for (const name of Object.keys(nextWindowMethods ?? {})) {
  if (nextMethods && name in nextMethods) {
    throw new Error(`Method name "${name}" registered as both object method and window method on "${type}"`);
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test packages/@ooc/core/__tests__/window-method-dispatch.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/@ooc/core/executable/windows/_shared/manager.ts packages/@ooc/core/runtime/object-registry.ts packages/@ooc/core/__tests__/window-method-dispatch.test.ts
git commit -m "feat(manager): windowMethod dispatch 分流 + state immutable 写回 + 同名校验"
```

---

## Task 5: 通用执行体改返回新 state（不再 Object.assign mutate）

**Files:**
- Modify: `packages/@ooc/core/executable/windows/_shared/viewport.ts:31-49`
- Modify: `packages/@ooc/core/executable/windows/_shared/transcript-viewport.ts:32-51`
- Modify: `packages/@ooc/builtins/_shared/executable/viewport-adapter.ts:70-89`
- Test: `packages/@ooc/core/__tests__/window-viewport-exec.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/@ooc/core/__tests__/window-viewport-exec.test.ts
import { test, expect } from "bun:test";
import { windowSetViewport } from "../executable/windows/_shared/viewport.js";

test("windowSetViewport returns new state, does not mutate input", () => {
  const windowState = { viewport: { lineStart: 0, lineEnd: 10, columnStart: 0, columnEnd: 80 } };
  const out = windowSetViewport({ args: { line_end: 200 }, windowState } as any, "file");
  expect(out.ok).toBe(true);
  if (out.ok) expect(out.state.viewport?.lineEnd).toBe(200);
  expect(windowState.viewport.lineEnd).toBe(10); // input untouched
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/@ooc/core/__tests__/window-viewport-exec.test.ts`
Expected: FAIL — `windowSetViewport` not exported (current name `executeWindowSetViewport`, mutates `ctx.self`).

- [ ] **Step 3: Rewrite executeWindowSetViewport → windowSetViewport**

Replace `viewport.ts:31-49` body:
```ts
export function windowSetViewport(
  ctx: WindowMethodExecutionContext,
  _type: string,
): WindowMethodOutcome {
  if (!hasAnyViewportField(ctx.args)) {
    return { ok: true, state: ctx.windowState, result: "no viewport field provided; unchanged" };
  }
  const current = ctx.windowState.viewport ?? DEFAULT_VIEWPORT;
  const merged = mergeViewport(current, ctx.args);
  if (!merged.ok) return { ok: false, error: merged.error };
  return { ok: true, state: { ...ctx.windowState, viewport: merged.viewport } };
}
```
Apply the analogous rewrite to `transcript-viewport.ts` (`windowSetTranscriptViewport`, sets `state.transcriptViewport`) and `viewport-adapter.ts` (`makeWindowViewportAdapter`, sets `state[spec.windowField]` where windowField ∈ `resultsViewport`/`historyViewport`). All three: read from `ctx.windowState`, return `{ ok, state: { ...ctx.windowState, [field]: merged } }`, never touch `ctx.self`.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/@ooc/core/__tests__/window-viewport-exec.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/@ooc/core/executable/windows/_shared/viewport.ts packages/@ooc/core/executable/windows/_shared/transcript-viewport.ts packages/@ooc/builtins/_shared/executable/viewport-adapter.ts packages/@ooc/core/__tests__/window-viewport-exec.test.ts
git commit -m "refactor(viewport-exec): 执行体返回新 WindowDisplayState,移除 ctx.self mutate"
```

---

## Task 6: file builtin 迁移（EXEMPLAR — 后续 builtin 照此模式）

**Files:**
- Modify: `packages/@ooc/builtins/file/executable/index.ts`（`setViewportCommand` :190-217；`setRangeCommand` :174-188；`executeFileWindowSetRange` :356-370；注册表 :737-748）
- Modify: `packages/@ooc/builtins/file/types.ts:19-23`
- Modify: `packages/@ooc/builtins/file/readable.ts:39,60`
- Test: `packages/@ooc/builtins/file/__tests__/file-window-method.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/@ooc/builtins/file/__tests__/file-window-method.test.ts
import { test, expect } from "bun:test";
import { builtinRegistry } from "@ooc/core/runtime/object-registry.js";
import "@ooc/builtins/file/executable/index.js"; // side-effect register

test("file set_viewport is a windowMethod, not an object method", () => {
  const def = builtinRegistry.getObjectDefinition("file");
  expect(def?.windowMethods?.set_viewport).toBeDefined();
  expect(def?.methods?.set_viewport).toBeUndefined();
});

test("file readable reads viewport from window.state (back-compat falls back to legacy)", async () => {
  const { readable } = await import("@ooc/builtins/file/readable.js");
  // state-based
  const nodesNew = await readable({ window: { type: "file", path: "/etc/hostname", state: { viewport: { lineStart: 0, lineEnd: 1, columnStart: 0, columnEnd: 80 } } }, thread: {} } as any);
  expect(JSON.stringify(nodesNew)).toContain("viewport");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/@ooc/builtins/file/__tests__/file-window-method.test.ts`
Expected: FAIL — `set_viewport` still under `methods`; readable reads `window.viewport` not `window.state.viewport`.

- [ ] **Step 3: Convert set_viewport / set_range to WindowMethod**

In `file/executable/index.ts`:
- `setViewportCommand` → typed `WindowMethod`, `exec: (ctx) => windowSetViewport(ctx, "file")`.
- `setRangeCommand` → `WindowMethod`; rewrite `executeFileWindowSetRange` to read `ctx.windowState` and return `{ ok: true, state: { ...ctx.windowState, /* lines/columns live on state if retained, else keep on window via object method */ } }`. **Decision:** `lines`/`columns` are legacy file slicing also used as display → move under `state` too, or keep `set_range` as object method. Per spec, `set_range` controls display → make it a windowMethod writing `state.viewport` (treat range as viewport sugar). Simplest: have `set_range` compute a `viewport` and return it on state.
- Registration (:738-745): split the table — move `set_range`, `set_viewport` into a new `windowMethods` arg; keep `reload`, `edit`, `close`, `file` in `methods`:
```ts
builtinRegistry.registerObjectType("file", {
  type: "file",
  methods: { reload, edit, close, file },
  windowMethods: { set_range, set_viewport },
  readable,
  // ...other existing fields (renderXml/compressView/parentClass etc. unchanged)
});
```

- [ ] **Step 4: Move display fields onto state + readable reads state**

In `file/types.ts`, the `viewport`/`lines`/`columns` fields are now sourced from `window.state` (keep the legacy top-level optional fields for back-compat read during migration, mark `@deprecated`).
In `file/readable.ts`: change `:39` to `const viewport = window.state?.viewport ?? window.viewport ?? DEFAULT_VIEWPORT;` and `:52-57` lines/columns reads to `window.state?.viewport ? sliceFromViewport : (window.lines ...)` back-compat.

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test packages/@ooc/builtins/file/__tests__/file-window-method.test.ts`
Expected: PASS.

- [ ] **Step 6: Run broader file + manager tests for regressions**

Run: `bun test packages/@ooc/builtins/file/ packages/@ooc/core/__tests__/window-method-dispatch.test.ts`
Expected: PASS (no regression).

- [ ] **Step 7: Commit**

```bash
git add packages/@ooc/builtins/file/
git commit -m "feat(file): set_viewport/set_range 迁为 windowMethod + readable 读 window.state(exemplar)"
```

---

## Task 7: 其余 builtin 迁移（按 Task 6 exemplar）

逐个 builtin 重复 Task 6 的模式（convert→windowMethods 注册→readable/renderXml 读 state→测试）。每个先写 `windowMethods?.X 存在 && methods?.X 不存在` 的失败测试，再迁移。

- [ ] **Step 1: knowledge** — `set_viewport`（`knowledge/executable/index.ts:101-128`，注册 :247-256 → `windowMethods: { set_viewport }`，`methods: { reload, close, open_knowledge }`）；exec→`windowSetViewport(ctx,"knowledge")`；`knowledge/readable.ts:39` 读 `window.state?.viewport ?? window.viewport ?? DEFAULT_VIEWPORT`。Test: `knowledge/__tests__/knowledge-window-method.test.ts`. Commit `feat(knowledge): set_viewport 迁 windowMethod`.

- [ ] **Step 2: search** — `set_results_window`（`search/executable/method.set-results-window.ts:58-84`；执行体 `results-viewport.ts:40-44` 改用 `makeWindowViewportAdapter`(`historyField`→`resultsViewport`) 返回 state）。**注意二次注册**：`search/executable/index.ts:263` 与 :470 两处都要把 `set_results_window` 从 methods 移到 windowMethods。`search/readable.ts:21` 读 `window.state?.resultsViewport ?? window.resultsViewport ?? DEFAULT_RESULTS_VIEWPORT`。Test: `search/__tests__/search-window-method.test.ts`. Commit `feat(search): set_results_window 迁 windowMethod(含二次注册)`.

- [ ] **Step 3: program** — `set_history_window`（`program/executable/index.ts:146-172`；执行体 `history-viewport.ts:43-47` → adapter 写 `state.historyViewport`；注册 :358 → windowMethods）。`program/readable.ts:20` 读 `window.state?.historyViewport ?? window.historyViewport ?? DEFAULT_HISTORY_VIEWPORT`。Test: `program/__tests__/program-window-method.test.ts`. Commit `feat(program): set_history_window 迁 windowMethod`.

- [ ] **Step 4: talk** — `set_transcript_window`（`core/executable/windows/talk/command.set-transcript-window.ts:81-107`；exec→`windowSetTranscriptViewport(ctx,["talk"])` 返回 `state.transcriptViewport`；注册 `talk/index.ts:366` → windowMethods）。talk 用 `renderXml` hook（`talk/index.ts:70-72`）非 readable 字段：改 `const vp = window.state?.transcriptViewport ?? window.transcriptViewport ?? DEFAULT_TRANSCRIPT_VIEWPORT`。Test: `talk` 现有测试目录加 `talk-window-method.test.ts`. Commit `feat(talk): set_transcript_window 迁 windowMethod + renderXml 读 state`.

- [ ] **Step 5: do** — 同 talk：`do/command.set-transcript-window.ts:81-107`；注册 `do/index.ts` methods 表（import :28）→ windowMethods；`do/index.ts:70-72` renderXml 读 `window.state?.transcriptViewport ?? ...`。Test: `do-window-method.test.ts`. Commit `feat(do): set_transcript_window 迁 windowMethod + renderXml 读 state`.

- [ ] **Step 6: Run all builtin + manager tests**

Run: `bun test packages/@ooc/builtins/ packages/@ooc/core/executable/windows/`
Expected: PASS（无回归）。

---

## Task 8: 持久化 + 跨 world 回归验证

**Files:**
- Test: `packages/@ooc/core/__tests__/window-state-persistence.test.ts`

- [ ] **Step 1: Write the test**

```ts
// packages/@ooc/core/__tests__/window-state-persistence.test.ts
import { test, expect } from "bun:test";
// 经 WindowManager.toData() 序列化后 window.state 应保留;
// 重新 fromThread 后 readable 按 state 渲染。
test("window.state survives toData round-trip", () => {
  const thread = makeThreadWithWindow({ id: "f1", type: "file", path: "/etc/hostname", state: { viewport: { lineStart: 0, lineEnd: 5, columnStart: 0, columnEnd: 80 } } });
  const mgr = WindowManager.fromThread(thread, registry);
  const data = mgr.toData();
  expect((data.find((w:any)=>w.id==="f1") as any).state.viewport.lineEnd).toBe(5);
});
```
> 复用 Task 4 的 thread/window 夹具 + builtinRegistry。

- [ ] **Step 2: Run + verify PASS** — `bun test packages/@ooc/core/__tests__/window-state-persistence.test.ts`。`toData()` 整对象序列化（manager.ts:179-181）天然带 `state` 子字段，应直接 PASS；若 FAIL 说明序列化 strip 了未知字段，需在 `writeThreadContextSnapshot`(manager.ts:887-908) 确认 inline 路径保留 state。

- [ ] **Step 3: Run the storybook control-plane gate**

Run: `bun run test:storybook`
Expected: 0 FAIL（readable/executable story 若断言旧平铺 viewport 字段，更新为 `window.state.viewport`）。

- [ ] **Step 4: Commit**

```bash
git add packages/@ooc/core/__tests__/window-state-persistence.test.ts
git commit -m "test(window-state): toData 持久化 round-trip + storybook gate 回归"
```

---

## Task 9: 概念文档收编（object.doc.ts）

**Files:**
- Modify: `packages/@ooc/meta/object.doc.ts`（readable 节点 :74/:110/:179-183；executable 节点；viewport 协议 :1317-1454）

- [ ] **Step 1: Edit readable node**

readable 节点正文补一句（遵循「文档语言精确简洁」）：readable 维度除构造 context 展示外，**注册 window method（`windowMethods`）并持有 window 状态对象（`WindowDisplayState`，持久化在 thread-context）控制展示**；window method 签名不同于 object method——额外接收 windowState、返回新 state。

- [ ] **Step 2: Edit executable node**

executable 节点明确：`methods` 是 **object method**，控制 object 自身业务数据；展示控制方法已分出到 readable 的 `windowMethods`。

- [ ] **Step 3: Update viewport 协议节点（:1317-1454）**

把 set_viewport 等的归属从 executable 改述为 readable windowMethod；调用样例 `exec(window_id, command="set_viewport", args={...})` 不变（exec 入口统一），但说明其改的是 window 状态对象。

- [ ] **Step 4: Validate doc compiles**

Run: `bun tsc --noEmit packages/@ooc/meta/object.doc.ts`
Expected: 0 errors（`DocTreeNode.sources` 单 entry 约束遵守）。

- [ ] **Step 5: Commit**

```bash
git add packages/@ooc/meta/object.doc.ts
git commit -m "docs(object.doc): readable 收编 windowMethods+window 状态对象;executable 限于 object method"
```

---

## Self-Review 结论（已核对 spec Part 2）

- ✅ window 状态对象（`WindowDisplayState`，持久化 thread-context）— Task 1。
- ✅ window method 独立签名（接收 windowState）— Task 2。
- ✅ 物理分表 `windowMethods` 归 readable + registry 白名单 — Task 3。
- ✅ dispatch 注入 state + immutable 写回 — Task 4。
- ✅ 执行体去 mutate — Task 5；6 个展示 method 迁移 — Task 6/7。
- ✅ readable/renderXml 读 state（向后兼容）— Task 6/7。
- ✅ 概念文档收编 — Task 9。
- ⚠️ 命名一致性：执行体新名 `windowSetViewport`/`windowSetTranscriptViewport`/`makeWindowViewportAdapter` 在 Task 5 定义、Task 6/7 引用，须一致。
- ⚠️ `set_range` 归属（windowMethod 写 state.viewport）在 Task 6 Step 3 已定，避免遗留 lines/columns 双源——实现时确认 file readable 不再双读。

**风险点（须实现时验证，非 placeholder）**：① talk/do 走 `renderXml` 非 `readable`，改 RenderContext 入参会波及 compressView——本计划选择**不改 RenderContext 签名**，readable/renderXml 从 `ctx.window.state` 读，规避波及面。② `seedFrom` 跨 world 必须带 windowMethods（Task 3 测试已覆盖）。③ search 二次注册两处都要改（Task 7 Step 2）。

---

## Review 修订（Supervisor 拍板，2026-06-08 技术 review 后）

技术 reviewer 实读源码后发现多处会让实现失败的硬伤，以下修订**优先于上文，实现时按此**：

**C1 — registry 私有字段是 `this.store`（非 `this.definitions`）。** Task 3 的 `resolveWindowMethod` 必须用 `this.store.get(type)`，并严格镜像现有 `resolveMethod`（`object-registry.ts:177-190`）。`resolveParentClassChain` 在 `:137` 也读 `this.store`。

**C2 — `registerObjectType` 对未 seed 的类型会 throw（`:83-85` `if(!existing) throw`）。** 它只更新 `BASE_TYPE_DEFINITIONS`（`:56-72`）里的 base 类型；新 user 类型必须走 `registerNewObjectType`（`:102-119`）。Task 3 测试里的 `base_doc`/`my_doc` 改用 `registerNewObjectType`。白名单：`registerObjectType` 字面量（`:88-99`）显式加 `windowMethods`；`registerNewObjectType` 走 `...definition` spread 自动带过（无需重复 set）；`seedFrom`（`:249-260`）必须 **key-merge** `windowMethods`（`{...existing.windowMethods, ...def.windowMethods}`），像它对 `methods` 那样（H4）。

**C3 — `submit` 必须返回 `string | undefined`（被 `method_exec/submit.ts:39-48` 当字符串拼接）。** windowMethod 分支**不可** early-return `{result}/{error}` 对象（会渲染成 `[object Object]` 且绕过 form 清理）。正确做法：命中 windowMethod 时执行 `exec`→`upsertWindow({...parent, state: outcome.state})`→把 `outcome.result` 赋给局部 `result`（失败则 `result=outcome.error; isError=true`）→**fall through 到现有 ObjectMethod 路径同一段** success/fail 尾部（`manager.ts:716-734` 的 removeWindow/isError 记账）。即只替换"算 outcome"那一步，复用收尾。

**M1 — `lookupWindowMethod` 用 `this.store.get`（不用 `getObjectDefinition`，后者 unknown type 会 throw，`:121-125`）。**

**H1 — 现有 4 个 viewport 测试套件会破，必须迁移（新增 Task 7.5）：** `search-results-viewport.test.ts`（断言 `def.methods["set_results_window"]` + `exec({args,self})` 原地 mutate + 返回 undefined）、`program-history-viewport.test.ts`、`transcript-viewport-integration.test.ts`、`viewport-integration.test.ts`（`core/executable/windows/__tests__` 与 `_shared/__tests__`）。改为断言 `def.windowMethods[...]` + 新签名（`exec(ctx).state`）。Gate：`bun test packages/@ooc/core/executable/windows/`。

**H2 — `compressView` hook 读展示字段，须纳入"读 state"清扫。** `compressFileWindow`（`file/executable/index.ts`）`if(level===1 && window.lines)` 读 `window.lines`；search 也有 compressView。Task 6/7 的"读 state"必须包含各 builtin 的 compressView（向后兼容读 `window.state?.lines ?? window.lines`）。

**H3 — `lines`/`columns` 不是 viewport sugar，是独立的第二阶段切片（`file/readable.ts:39-64`：先 `applyViewport` 后 `sliceByLinesColumns`，二者复合）。** 修正 Task 1 的 `WindowDisplayState`：**加 `lines?: [number,number]` 与 `columns?: [number,number]` 字段**。`set_range`（windowMethod）写 `state.lines`/`state.columns`，`set_viewport` 写 `state.viewport`，互不覆盖。readable/visible/compressView 保留两阶段切片读 state。不要把 range 压成 viewport。

**M4 — Task 6 注册片段删掉 `type: "file"`。** `registerObjectType(type, partial)` 的 partial 是 `Partial<Omit<ObjectDefinition,"type">>`（`:83`），重复给 type 会类型错误（现有 `:737` 调用就没给 type）。

> 修订后 `WindowDisplayState`（Task 1）最终形态：`{ viewport?: Viewport; lines?: [number,number]; columns?: [number,number]; transcriptViewport?: TranscriptViewport; resultsViewport?: TranscriptViewport; historyViewport?: TranscriptViewport }`。
