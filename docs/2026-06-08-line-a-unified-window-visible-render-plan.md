# 线 A：统一 Window 渲染解析层（visible）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** thread_context 视图（`ContextSnapshotViewer`）展示任意 context window 时，统一"按 window 解析到它所属 class/object 的 visible 组件 → 渲染"——builtin 走前端静态注册表，user-defined object 走运行时动态加载（复用 `client-source-url`），消除 per-type switch、`HANDLED_WINDOW_TYPES` 硬编码集合与 user-defined 的 JSON 降级。

**Architecture:** 后端在 window enrichment（与 `effectiveVisibleType` 同处）给每个 window stamp `sourceObjectId` + `sourceScope`（+ flow 时 `sourceSessionId`），让前端 resolver 自洽。前端新增 `builtin-visible-registry`（集中收拢 9 个 builtin `WindowDetail` + 现内联组件 relation/feishu/method_exec/do/talk/form_guidance，统一为 `({window}) => JSX`）与 `resolveWindowVisible(window)`：`effectiveVisibleType ?? type` 命中注册表 → builtin 组件；否则用 stamp 的 `sourceObjectId`+`sourceScope` 走 `client-source-url` 动态 import；否则 JSON 兜底。`ContextSnapshotViewer` 删 switch、接 resolver，保留正交的 transcript/composer/command-chips。

**Tech Stack:** TypeScript / React / vite（`/@fs` dynamic import）/ bun:test + Playwright。

> 设计来源：`docs/2026-06-08-window-visible-render-and-readable-window-method-design.md` Part 1。决策：window 定位走**后端 enrich**（非前端 plumbing）。本计划只覆盖线 A（前端渲染 + 少量后端 enrich）；线 B（windowMethods/readable）是独立 plan。

---

## 文件结构

**新建：**
- `packages/@ooc/web/src/domains/files/components/visible/builtin-visible-registry.tsx` — `Record<string, ComponentType<{window}>>` builtin 注册表（含被搬出的内联组件）。
- `packages/@ooc/web/src/domains/files/components/visible/resolveWindowVisible.tsx` — 解析 + 动态加载 + 兜底。
- `packages/@ooc/web/src/domains/files/components/visible/__tests__/resolveWindowVisible.test.ts` — 解析顺序单测。

**修改：**
- `packages/@ooc/core/thinkable/context/window-enrichment.ts:110-113` — stamp `sourceObjectId`/`sourceScope`/`sourceSessionId`。
- `packages/@ooc/core/persistable/debug-file.ts:50` — 快照序列化同 stamp。
- `packages/@ooc/core/_shared/types/context-window.ts` — `BaseContextWindow` 加可选 source 字段。
- `packages/@ooc/web/src/domains/files/context-snapshot.ts:299-317` — 前端 `ContextWindow` 类型加 source 字段。
- `packages/@ooc/web/src/domains/files/components/ContextSnapshotViewer.tsx` — 删 import :65-73 / `HANDLED_WINDOW_TYPES` :102-118 / switch :733-794 / JSON 兜底 :795-805；接 `resolveWindowVisible`；保留 common rows + transcript + chips。

---

## Task 1: 后端 enrich window source 信息 + 类型

**Files:**
- Modify: `packages/@ooc/core/_shared/types/context-window.ts`（`BaseContextWindow`）
- Modify: `packages/@ooc/core/runtime/object-registry.ts:222-228`（`resolveEffectiveVisibleType` 旁加 source 判定 helper，或在 enrichment 调用点判定）
- Modify: `packages/@ooc/core/thinkable/context/window-enrichment.ts:110-113`
- Modify: `packages/@ooc/core/persistable/debug-file.ts:50`
- Test: `packages/@ooc/core/__tests__/window-source-enrichment.test.ts`

**契约**：enrich 时给每个 window 计算 `sourceObjectId`/`sourceScope`（+ flow 时 `sourceSessionId`）：
- builtin renderable type（在 `RENDERABLE_VISIBLE_TYPES`，含经 parentClass 回退命中的）→ 不需 source（前端走静态注册表）；可不 stamp 或 stamp 但前端忽略。
- user-defined（`resolveEffectiveVisibleType` 返回 `undefined`，即 self-window）→ `sourceObjectId = window.type`，`sourceScope` 取该 object 的存储域：world stones 中存在该 object → `"stone"`；否则若是 flow object → `"flow"` + `sourceSessionId = <当前 thread 的 sessionId>`。

- [ ] **Step 1: Write the failing test**

```ts
// packages/@ooc/core/__tests__/window-source-enrichment.test.ts
import { test, expect } from "bun:test";
import { enrichWindowSource } from "../thinkable/context/window-enrichment.js";
import { builtinRegistry } from "../runtime/object-registry.js";

test("user-defined self window gets sourceObjectId=type, scope=stone", () => {
  const w = enrichWindowSource({ id: "my_agent", type: "my_agent" } as any, { registry: builtinRegistry, sessionId: "s1", isStone: true });
  expect(w.sourceObjectId).toBe("my_agent");
  expect(w.sourceScope).toBe("stone");
});

test("builtin file window gets no source (resolver uses static registry)", () => {
  const w = enrichWindowSource({ id: "f1", type: "file" } as any, { registry: builtinRegistry, sessionId: "s1", isStone: false });
  expect(w.sourceObjectId).toBeUndefined();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/@ooc/core/__tests__/window-source-enrichment.test.ts`
Expected: FAIL — `enrichWindowSource` not exported.

- [ ] **Step 3: Add source fields to BaseContextWindow**

`context-window.ts` (`BaseContextWindow`):
```ts
  /** 线 A：前端 resolveWindowVisible 用于动态加载 user-defined object 的 visible。
   *  builtin renderable window 不 stamp（前端走静态注册表）。 */
  sourceObjectId?: string;
  sourceScope?: "stone" | "flow";
  sourceSessionId?: string;
```

- [ ] **Step 4: Implement enrichWindowSource + wire into enrichment**

In `window-enrichment.ts`, add exported helper and call it alongside the `effectiveVisibleType` stamp (:110-113):
```ts
export function enrichWindowSource(
  window: BaseContextWindow,
  ctx: { registry: ObjectRegistry; sessionId?: string; isStone: boolean },
): BaseContextWindow {
  const eff = ctx.registry.resolveEffectiveVisibleType(window.type);
  if (eff !== undefined) return window; // builtin renderable → static registry handles it
  // user-defined self window
  const sourceScope = ctx.isStone ? "stone" : "flow";
  return {
    ...window,
    sourceObjectId: window.type,
    sourceScope,
    ...(sourceScope === "flow" && ctx.sessionId ? { sourceSessionId: ctx.sessionId } : {}),
  };
}
```
> `isStone` 判定：从 enrichment 上下文已知该 window 对应 object 是否存在于 world stones（grep enrichment 调用点是否已有 stone/flow 区分；若无，先用 `sourceScope: "stone"` 作默认——user-defined object 多为 stone object——并在 Task 5 端到端验证修正）。在 `debug-file.ts:50` 快照序列化处同样调用 `enrichWindowSource`。

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test packages/@ooc/core/__tests__/window-source-enrichment.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/@ooc/core/_shared/types/context-window.ts packages/@ooc/core/thinkable/context/window-enrichment.ts packages/@ooc/core/persistable/debug-file.ts packages/@ooc/core/__tests__/window-source-enrichment.test.ts
git commit -m "feat(window-enrich): stamp sourceObjectId/scope 供前端动态加载 user-defined visible"
```

---

## Task 2: 前端 builtin 静态注册表（含内联组件搬迁）

**Files:**
- Create: `packages/@ooc/web/src/domains/files/components/visible/builtin-visible-registry.tsx`
- Modify: `ContextSnapshotViewer.tsx`（把内联 `RelationWindowDetail` :379-427 / `FeishuChatWindowDetail` :529-594 / `FeishuDocWindowDetail` :599-689 抽到独立文件供注册表 import；do/talk/form_guidance 内联 JSX 包装成组件）
- Modify: 前端 `ContextWindow` 类型加 source 字段（`context-snapshot.ts:299-317`）
- Test: `packages/@ooc/web/src/domains/files/components/visible/__tests__/builtin-visible-registry.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// builtin-visible-registry.test.ts
import { test, expect } from "bun:test";
import { BUILTIN_VISIBLE } from "../builtin-visible-registry";

test("registry covers all renderable builtin types", () => {
  for (const t of ["file","knowledge","todo","search","skill_index","plan","program","root","method_exec","relation","feishu_chat","feishu_doc","do","talk","form_guidance"]) {
    expect(BUILTIN_VISIBLE[t]).toBeDefined();
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/@ooc/web/src/domains/files/components/visible/__tests__/builtin-visible-registry.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Extract inline components**

Move `RelationWindowDetail`/`FeishuChatWindowDetail`/`FeishuDocWindowDetail` from `ContextSnapshotViewer.tsx` into sibling files under `visible/` (e.g. `visible/RelationWindowDetail.tsx`), each `export default function ({ window }: { window: ContextWindow }) => JSX`. Wrap the inline `do`/`talk`/`form_guidance` bodies into `visible/DoWindowDetail.tsx` / `TalkWindowDetail.tsx` / `FormGuidanceWindowDetail.tsx` with the same `({window})` signature. (Keep talk's transcript/composer in ContextSnapshotViewer — only the visual *body* moves.)

- [ ] **Step 4: Build the registry**

```tsx
// builtin-visible-registry.tsx
import type { ComponentType } from "react";
import type { ContextWindow } from "../../context-snapshot";
import KnowledgeWindowDetail from "@ooc/builtins/knowledge/visible/index.tsx";
import FileWindowDetail from "@ooc/builtins/file/visible/index.tsx";
import TodoWindowDetail from "@ooc/builtins/todo/visible/index.tsx";
import SearchWindowDetail from "@ooc/builtins/search/visible/index.tsx";
import SkillIndexWindowDetail from "@ooc/builtins/skill_index/visible/index.tsx";
import PlanWindowDetail from "@ooc/builtins/plan/visible/index.tsx";
import ProgramWindowDetail from "@ooc/builtins/program/visible/index.tsx";
import RootWindowDetail from "@ooc/builtins/root/visible/index.tsx";
import MethodExecWindowDetail from "../MethodExecWindowDetail";
import RelationWindowDetail from "./RelationWindowDetail";
import FeishuChatWindowDetail from "./FeishuChatWindowDetail";
import FeishuDocWindowDetail from "./FeishuDocWindowDetail";
import DoWindowDetail from "./DoWindowDetail";
import TalkWindowDetail from "./TalkWindowDetail";
import FormGuidanceWindowDetail from "./FormGuidanceWindowDetail";

export const BUILTIN_VISIBLE: Record<string, ComponentType<{ window: ContextWindow }>> = {
  file: FileWindowDetail, knowledge: KnowledgeWindowDetail, todo: TodoWindowDetail,
  search: SearchWindowDetail, skill_index: SkillIndexWindowDetail, plan: PlanWindowDetail,
  program: ProgramWindowDetail, root: RootWindowDetail, method_exec: MethodExecWindowDetail,
  relation: RelationWindowDetail, feishu_chat: FeishuChatWindowDetail, feishu_doc: FeishuDocWindowDetail,
  do: DoWindowDetail, talk: TalkWindowDetail, form_guidance: FormGuidanceWindowDetail,
};
```
Add source fields to frontend `ContextWindow` type (`context-snapshot.ts`): `sourceObjectId?`, `sourceScope?`, `sourceSessionId?`.

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test packages/@ooc/web/src/domains/files/components/visible/__tests__/builtin-visible-registry.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/@ooc/web/src/domains/files/components/visible/ packages/@ooc/web/src/domains/files/components/ContextSnapshotViewer.tsx packages/@ooc/web/src/domains/files/context-snapshot.ts
git commit -m "feat(visible): builtin 静态注册表 + 内联组件搬迁(relation/feishu/do/talk/form_guidance)"
```

---

## Task 3: resolveWindowVisible 解析 + user-defined 动态加载

**Files:**
- Create: `packages/@ooc/web/src/domains/files/components/visible/resolveWindowVisible.tsx`
- Test: `.../visible/__tests__/resolveWindowVisible.test.ts`

**契约（解析顺序，镜像后端 `resolveEffectiveVisibleType`）：**
1. `key = window.effectiveVisibleType ?? window.type`，`BUILTIN_VISIBLE[key]` 命中 → 返回 builtin 组件。
2. 否则 `window.sourceObjectId` 存在 → 返回一个动态加载组件（用 `sourceScope`/`sourceObjectId`/`sourceSessionId` 走 `client-source-url`，`import(/* @vite-ignore */ fsUrl)` 取 default，传 `{ window }`），Suspense + error boundary 包裹。
3. 否则 → JSON 兜底组件（保留现有 CodeMirror readonly 块）。

- [ ] **Step 1: Write the failing test**

```ts
// resolveWindowVisible.test.ts
import { test, expect } from "bun:test";
import { resolveWindowVisibleKind } from "../resolveWindowVisible";

test("builtin type resolves to static", () => {
  expect(resolveWindowVisibleKind({ type: "file" } as any)).toEqual({ kind: "static", key: "file" });
});
test("effectiveVisibleType wins over type", () => {
  expect(resolveWindowVisibleKind({ type: "my_doc", effectiveVisibleType: "file" } as any)).toEqual({ kind: "static", key: "file" });
});
test("user-defined with source resolves to dynamic", () => {
  expect(resolveWindowVisibleKind({ type: "my_agent", sourceObjectId: "my_agent", sourceScope: "stone" } as any)).toEqual({ kind: "dynamic", objectId: "my_agent", scope: "stone", sessionId: undefined });
});
test("no source falls to json", () => {
  expect(resolveWindowVisibleKind({ type: "weird" } as any)).toEqual({ kind: "json" });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test .../visible/__tests__/resolveWindowVisible.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement resolver**

```tsx
// resolveWindowVisible.tsx
import { lazy, Suspense, type ComponentType } from "react";
import type { ContextWindow } from "../../context-snapshot";
import { BUILTIN_VISIBLE } from "./builtin-visible-registry";
import { endpoints } from "../../../../transport/endpoints";
import { requestJson } from "../../../../transport/http"; // confirm helper path

export type WindowVisibleKind =
  | { kind: "static"; key: string }
  | { kind: "dynamic"; objectId: string; scope: "stone" | "flow"; sessionId?: string }
  | { kind: "json" };

export function resolveWindowVisibleKind(window: ContextWindow): WindowVisibleKind {
  const key = window.effectiveVisibleType ?? window.type;
  if (BUILTIN_VISIBLE[key]) return { kind: "static", key };
  if (window.sourceObjectId && window.sourceScope) {
    return { kind: "dynamic", objectId: window.sourceObjectId, scope: window.sourceScope, sessionId: window.sourceSessionId };
  }
  return { kind: "json" };
}

const dynamicCache = new Map<string, ComponentType<{ window: ContextWindow }>>();
function loadDynamic(objectId: string, scope: "stone" | "flow", sessionId?: string) {
  const cacheKey = `${scope}:${objectId}:${sessionId ?? ""}`;
  let comp = dynamicCache.get(cacheKey);
  if (!comp) {
    comp = lazy(async () => {
      const url = endpoints.clientSourceUrl(scope, objectId, { sessionId, page: "index" });
      const { fsUrl } = await requestJson<{ absPath: string; fsUrl: string }>(url);
      const mod = (await import(/* @vite-ignore */ fsUrl)) as { default?: ComponentType<{ window: ContextWindow }> };
      if (!mod.default) return { default: () => null };
      return { default: mod.default };
    });
    dynamicCache.set(cacheKey, comp);
  }
  return comp;
}

export function WindowVisible({ window, jsonFallback }: { window: ContextWindow; jsonFallback: ComponentType<{ window: ContextWindow }> }) {
  const r = resolveWindowVisibleKind(window);
  if (r.kind === "static") {
    const C = BUILTIN_VISIBLE[r.key];
    return <C window={window} />;
  }
  if (r.kind === "dynamic") {
    const C = loadDynamic(r.objectId, r.scope, r.sessionId);
    return <Suspense fallback={<div className="loading">…</div>}><C window={window} /></Suspense>;
  }
  const J = jsonFallback;
  return <J window={window} />;
}
```
> 复用 `ObjectClientRenderer` 现有的 `resolveClientSource` + error boundary 而非裸 `requestJson`，更稳：实现时优先 import 其内部 helper；若未导出，照其 :62-82/:177-238 模式内联。flow scope 的 `page` 默认 `"index"`——确认 user-defined window 的 visible 是 stone scope（`visible/index.tsx`）还是 flow page。stone scope 不需 page。

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test .../visible/__tests__/resolveWindowVisible.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/@ooc/web/src/domains/files/components/visible/resolveWindowVisible.tsx packages/@ooc/web/src/domains/files/components/visible/__tests__/resolveWindowVisible.test.ts
git commit -m "feat(visible): resolveWindowVisible 解析 + user-defined 动态加载 + JSON 兜底"
```

---

## Task 4: ContextSnapshotViewer 接入解析层

**Files:**
- Modify: `packages/@ooc/web/src/domains/files/components/ContextSnapshotViewer.tsx`（删 :65-73 import、:102-118 `HANDLED_WINDOW_TYPES`、:733-794 switch、:795-805 JSON 块；`WindowDetail` :692 内接 `WindowVisible`；保留 common rows :707-732、`WindowCommandsChips` :724、transcript block :806-846）

- [ ] **Step 1: Replace switch with WindowVisible**

In `WindowDetail` (:692), after the common rows (:732) and before the transcript block (:806), replace the deleted type-switch + JSON block with:
```tsx
<WindowVisible window={window} jsonFallback={JsonFallback} />
```
where `JsonFallback` is a small local component wrapping the existing CodeMirror readonly JSON block (preserve it verbatim, just extract to `({window}) => <CodeMirror .../>`).

- [ ] **Step 2: Delete dead code**

Remove the 9 builtin `WindowDetail` imports (:65-73, now in registry), the `HANDLED_WINDOW_TYPES` set (:102-118), and the moved inline components (now under `visible/`). Keep `effectiveVisibleType` only if still referenced; the resolver handles it internally now.

- [ ] **Step 3: Type-check + unit**

Run: `cd packages/@ooc/web && bunx tsc --noEmit`
Expected: 0 errors (fix any dangling references to removed symbols).
Run: `bun test packages/@ooc/web/src/domains/files/components/visible/`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/@ooc/web/src/domains/files/components/ContextSnapshotViewer.tsx
git commit -m "refactor(visible): ContextSnapshotViewer 接 resolveWindowVisible,删 switch/HANDLED_WINDOW_TYPES/JSON 降级"
```

---

## Task 5: 端到端验证（builtin 渲染不回归 + user-defined 自渲染）

**Files:**
- Test: `tests/e2e/`（新增或扩展 thread_context 渲染场景）+ storybook `visible` story

- [ ] **Step 1: builtin 不回归** — 启动 backend（`--world ./.ooc-world`）+ 前端，打开含 file/knowledge/todo/search/program/talk/do window 的 thread_context 视图，确认各 window 视觉体与改造前一致（截图比对）。Run storybook gate: `bun run test:storybook` → 0 FAIL（visible story 若断言 switch 行为，改断言 resolver 行为）。

- [ ] **Step 2: user-defined 自渲染** — 用 `_test_visible_<ts>` session：创建一个 user-defined stone object 并给它写 `visible/index.tsx`（default export `({window}) => <div data-testid="custom">…</div>`），经 HTTP versioning API 提交（worktree commit，勿直写）；在 thread_context 视图打开该 object 的 self-window，断言渲染出 `data-testid="custom"` 而非 JSON。验证后清理 session。

- [ ] **Step 3: JSON 兜底** — 一个无 visible 的 user-defined object 的 window，确认落 JSON 兜底（不报错、不白屏）。

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/ packages/@ooc/meta/storybook/
git commit -m "test(visible): thread_context 统一渲染 e2e(builtin 不回归 + user-defined 自渲染 + JSON 兜底)"
```

---

## Self-Review 结论（已核对 spec Part 1）

- ✅ 统一渲染解析层，去 per-type switch / HANDLED_WINDOW_TYPES — Task 2/3/4。
- ✅ builtin 静态注册表（含被遗漏的内联组件，避免回退 JSON）— Task 2。
- ✅ user-defined 动态加载复用 client-source-url — Task 3。
- ✅ 后端 enrich 解决 window 定位阻塞（spec risk #1）— Task 1。
- ✅ effectiveVisibleType 继承链对齐（前端直接用 stamp 值）— Task 3 契约。
- ✅ 保留正交的 transcript/composer/command-chips — Task 4。
- ⚠️ 命名一致性：`BUILTIN_VISIBLE` / `resolveWindowVisibleKind` / `WindowVisible` / `enrichWindowSource` 跨 Task 引用须一致。
- ⚠️ 与线 B 的冲突点：两条线都改 `BaseContextWindow`（线 B 加 `state`，线 A 加 `source*`）——串行实现，后跑的线 rebase 前一条。

**风险点（实现时验证）**：① `isStone` 判定逻辑（Task 1 Step 4）——enrichment 上下文能否区分 user object 的 stone/flow 域；不足则默认 stone + 端到端修正。② `requestJson`/`resolveClientSource` helper 的确切导出路径（Task 3）——优先复用 `ObjectClientRenderer` 内部实现。③ `do`/`talk` 的视觉体从内联搬出后，与仍留在 viewer 的 transcript/composer 的边界（Task 2 Step 3）——只搬视觉体，交互留原处。
