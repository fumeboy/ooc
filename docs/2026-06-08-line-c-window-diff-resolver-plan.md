# 线 C：统一 Window Diff 渲染解析层（visible 对称）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** thread_context 的 loop diff 视图（`LoopDiffView`）展示某 window 的变化时，统一"按 window 解析到它所属 class/object 的 diff 组件 → 渲染"——builtin 走前端静态注册表（各 builtin 自己的 `visible/diff.tsx`），user-defined object 走回退链（先尝试自己的 diff 组件，再退到用自己的 `visible` 渲前/后对照），消除 web 包里按 window type 硬编码注册的 9 个 diff 渲染器。对称于线 A 的 `resolveWindowVisible`。

**Architecture:** 新约定：object 在 `visible/diff.tsx` **default export** 一个 `({ previous, current }: WindowDiffProps) => JSX` 组件（`previous`/`current` 是相邻两 loop 的 window 快照对象，added→previous 缺省、removed→current 缺省；`current` 可携带后端附挂的 `fileDiff` 等 payload）。把现有 9 个 web 渲染器迁入各自 builtin 包的 `visible/diff.tsx`（它们已能 import `@codemirror/merge` + web 的 diff 共享原语，与 `visible/index.tsx` import `FileWindowContentView` 同模式）。web 新增静态注册表 `BUILTIN_DIFF` + `resolveWindowDiff` 解析器（镜像 `resolveWindowVisible`）+ 分级回退链。`LoopDiffView` 删 per-type 硬编码 registry，改调 `resolveWindowDiff`。

**Tech Stack:** TypeScript / React / @codemirror/merge / bun:test。无新依赖。

> 设计来源：本会话方案 B 讨论 + `docs/2026-06-08-window-visible-render-and-readable-window-method-design.md`（线 A visible 哲学的 diff 延伸）。核心约束：diff 需 `previous`+`current` 两份快照，且内容级 diff（file）依赖后端附挂的 `fileDiff` payload（前端从 window 对象挖不出）——这是 diff 与 visible 的不对称点（详见风险 #1）。

---

## 分级回退链（resolveWindowDiff 的四档）

| 档 | 命中条件 | 渲染 | 依赖 |
|---|---|---|---|
| 1. builtin 静态 | `BUILTIN_DIFF[type]`（原始 type 直命中） | builtin 自己的 diff 组件 | 静态 import（编译期打包） |
| 2. user diff（增量） | user-defined object 写了 `visible/diff.tsx` | 动态加载该 object 的 diff 组件 | **需后端 client-source-url 支持寻址 visible/diff.tsx（Task 6）** |
| 3. 前/后对照（回退） | object 有 `visible/index.tsx` | 用 `WindowVisible` 渲 `previous` 与 `current` 并列 | 复用线 A 已打通的 visible 动态加载 |
| 4. JSON 兜底 | 都没有 | `FallbackJsonDiff`（保留现有） | 无 |

> MVP = 档 1+3+4（档 3 让未写 diff 的 user object 也有比裸 JSON 好的默认）。档 2 是带后端依赖的增量，Task 6 单列，可后置。

---

## 文件结构

**新建：**
- `packages/@ooc/web/src/domains/sessions/components/window-diff/window-diff-props.ts` — `WindowDiffProps` 约定类型（object 的 `visible/diff.tsx` 契约）。
- `packages/@ooc/web/src/domains/sessions/components/window-diff/builtin-diff-registry.tsx` — `Record<string, ComponentType<WindowDiffProps>>` builtin 静态 diff 注册表（import 各 builtin `visible/diff.tsx`）。
- `packages/@ooc/web/src/domains/sessions/components/window-diff/resolveWindowDiff.tsx` — 解析 + 四档回退。
- `packages/@ooc/web/src/domains/sessions/components/window-diff/__tests__/resolveWindowDiff.test.ts` — 解析顺序单测。
- `packages/@ooc/builtins/<type>/visible/diff.tsx` ×9（file/knowledge/search/program/talk/do/plan/relation/method_exec）— 迁入的 diff 组件。

**修改：**
- `packages/@ooc/web/src/domains/sessions/components/LoopDiffView.tsx:267-300+` — `renderDetail` 改调 `resolveWindowDiff`，删 `getWindowDiffRenderer`/`import "./window-diff-renderers"` 硬编码派发。
- `packages/@ooc/core/app/server/modules/ui/api.client-source-url.ts:54-71` — stone scope 支持 `?file=diff` 解析 `visible/diff.tsx`（Task 6，档 2）。
- `packages/@ooc/meta/object.doc.ts` — visible 节点收编"object 拥有 diff 渲染"；`loop_timeline.patches.type_dispatch_diff_renderer` 改述为解析层。

**删除（迁移后）：**
- `packages/@ooc/web/src/domains/sessions/components/window-diff-renderers/{registry.ts,index.ts,<Type>WindowDiff.tsx ×9}` — 渲染器迁入 builtin；`_shared.tsx`/`ErrorBoundary.tsx`/`FallbackJsonDiff.tsx` 保留（被 builtin diff 组件 + resolver 复用）。

---

## Task 1: WindowDiffProps 约定类型

**Files:**
- Create: `packages/@ooc/web/src/domains/sessions/components/window-diff/window-diff-props.ts`
- Test: `.../window-diff/__tests__/window-diff-props.test.ts`

**契约**：object 的 `visible/diff.tsx` default export `({ previous, current }) => JSX`。`previous`/`current` 是 window 快照对象（`current` 可带 `fileDiff` 等后端 payload）。

- [ ] **Step 1: Write the failing test**

```ts
// window-diff-props.test.ts
import { test, expect } from "bun:test";
import type { WindowDiffProps } from "../window-diff-props";

test("WindowDiffProps carries previous/current snapshots (either may be undefined)", () => {
  const added: WindowDiffProps = { previous: undefined, current: { id: "f1", type: "file" } as any };
  const removed: WindowDiffProps = { previous: { id: "f1", type: "file" } as any, current: undefined };
  expect(added.current?.type).toBe("file");
  expect(removed.previous?.type).toBe("file");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/@ooc/web/src/domains/sessions/components/window-diff/__tests__/window-diff-props.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Create the type**

```ts
// window-diff-props.ts
import type { ContextWindow } from "../../../files/context-snapshot";

/**
 * Object 的 visible/diff.tsx default export 契约（线 C，对称于 visible/index.tsx 的 {window}）。
 * previous/current = 相邻两 loop 的同 id window 快照；added→previous 缺省，removed→current 缺省。
 * current 可携带后端附挂的 diff payload（如 file 的 current.fileDiff），diff 组件按需读取。
 */
export interface WindowDiffProps {
  previous?: ContextWindow;
  current?: ContextWindow;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: same as Step 2 — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/@ooc/web/src/domains/sessions/components/window-diff/window-diff-props.ts packages/@ooc/web/src/domains/sessions/components/window-diff/__tests__/window-diff-props.test.ts
git commit -m "feat(window-diff): WindowDiffProps 约定类型(visible/diff.tsx 契约)"
```

---

## Task 2: 迁移 file diff 渲染器入 builtin（EXEMPLAR）

**Files:**
- Create: `packages/@ooc/builtins/file/visible/diff.tsx`（搬 `FileWindowDiff.tsx` 逻辑，default export `({previous,current})`）
- Test: `packages/@ooc/builtins/file/__tests__/file-visible-diff.test.tsx`

> 现 `FileWindowDiff` 用 `@codemirror/merge` `unifiedMergeView`，优先读 `current.fileDiff={previousContent,currentContent,path}`，fallback 挖 `content` 字段，再软退化（`FileWindowDiff.tsx:9-16`）。整段逻辑搬入，prop 名从 `WindowDiffRendererProps{previous,current,windowType,windowId}` 收敛为 `WindowDiffProps{previous,current}`（windowType/windowId 不再需要——type 由解析层定，id 不参与渲染）。

- [ ] **Step 1: Write the failing test**

```tsx
// file-visible-diff.test.tsx
import { test, expect } from "bun:test";
import FileDiff from "@ooc/builtins/file/visible/diff.tsx";

test("file visible/diff default-exports a component", () => {
  expect(typeof FileDiff).toBe("function");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/@ooc/builtins/file/__tests__/file-visible-diff.test.tsx`
Expected: FAIL — module missing.

- [ ] **Step 3: Move FileWindowDiff → file/visible/diff.tsx**

把 `web/.../window-diff-renderers/FileWindowDiff.tsx` 整体搬到 `packages/@ooc/builtins/file/visible/diff.tsx`：
- 改签名为 `export default function FileWindowDiff({ previous, current }: WindowDiffProps)`。
- import 路径调整：`@codemirror/*` 不变；`_shared` 工具（statusBg 等）从 web 引（与 `visible/index.tsx` import `@ooc/web/.../FileWindowContentView` 同模式）；`WindowSnapshotEntry`/`extractFileDiff` 等 helper 若仅此处用则一并搬入或从 web 引。
- 删 `windowType`/`windowId` prop 引用。

- [ ] **Step 4: Run test to verify it passes**

Run: same as Step 2 — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/@ooc/builtins/file/visible/diff.tsx packages/@ooc/builtins/file/__tests__/file-visible-diff.test.tsx
git commit -m "feat(file): FileWindowDiff 迁入 visible/diff.tsx(exemplar,对称 visible/index.tsx)"
```

---

## Task 3: BUILTIN_DIFF 静态注册表 + resolveWindowDiff 解析层

**Files:**
- Create: `packages/@ooc/web/src/domains/sessions/components/window-diff/builtin-diff-registry.tsx`
- Create: `packages/@ooc/web/src/domains/sessions/components/window-diff/resolveWindowDiff.tsx`
- Test: `.../window-diff/__tests__/resolveWindowDiff.test.ts`

**契约（解析顺序，镜像 `resolveWindowVisibleKind`）：**
1. `BUILTIN_DIFF[current?.type ?? previous?.type]` 命中 → `{kind:"static"}`。
2. 否则 user-defined → `{kind:"dynamic-diff", objectId, sessionId}`（档 2，Task 6 后端就绪前由组件内部 notFound 直接落档 3）。
3. dynamic-diff notFound / 未实现 → `{kind:"before-after", objectId}`（用 `WindowVisible` 渲 previous+current）。
4. object 无 visible → `{kind:"json"}`。

- [ ] **Step 1: Write the failing test**

```ts
// resolveWindowDiff.test.ts
import { test, expect } from "bun:test";
import { resolveWindowDiffKind } from "../resolveWindowDiff";

test("builtin type resolves to static", () => {
  expect(resolveWindowDiffKind({ current: { type: "file" } } as any)).toEqual({ kind: "static", key: "file" });
});
test("removed window uses previous.type", () => {
  expect(resolveWindowDiffKind({ previous: { type: "search" }, current: undefined } as any)).toEqual({ kind: "static", key: "search" });
});
test("user-defined resolves to before-after objectId=type", () => {
  expect(resolveWindowDiffKind({ current: { type: "my_agent" } } as any)).toEqual({ kind: "before-after", objectId: "my_agent" });
});
test("no type falls to json", () => {
  expect(resolveWindowDiffKind({ previous: undefined, current: undefined } as any)).toEqual({ kind: "json" });
});
```

> 注：MVP 解析顺序里 user-defined 直接给 `before-after`（档 2 暂不在 `resolveWindowDiffKind` 出分支，等 Task 6 后端就绪再插入 `dynamic-diff` 档，单测同步加用例）。

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test .../window-diff/__tests__/resolveWindowDiff.test.ts`
Expected: FAIL — module missing。

- [ ] **Step 3: Build registry + resolver**

```tsx
// builtin-diff-registry.tsx
import type { ComponentType } from "react";
import type { WindowDiffProps } from "./window-diff-props";
import FileDiff from "@ooc/builtins/file/visible/diff.tsx";
import KnowledgeDiff from "@ooc/builtins/knowledge/visible/diff.tsx";
import SearchDiff from "@ooc/builtins/search/visible/diff.tsx";
import ProgramDiff from "@ooc/builtins/program/visible/diff.tsx";
import TalkDiff from "@ooc/builtins/talk/visible/diff.tsx";
import DoDiff from "@ooc/builtins/do/visible/diff.tsx";
import PlanDiff from "@ooc/builtins/plan/visible/diff.tsx";
import RelationDiff from "@ooc/builtins/relation/visible/diff.tsx";
import MethodExecDiff from "@ooc/builtins/method_exec/visible/diff.tsx"; // 实际路径见迁移 Task 5
export const BUILTIN_DIFF: Record<string, ComponentType<WindowDiffProps>> = {
  file: FileDiff, knowledge: KnowledgeDiff, search: SearchDiff, program: ProgramDiff,
  talk: TalkDiff, do: DoDiff, plan: PlanDiff, relation: RelationDiff, method_exec: MethodExecDiff,
};
```
```tsx
// resolveWindowDiff.tsx
import { type ComponentType } from "react";
import type { WindowDiffProps } from "./window-diff-props";
import type { ContextWindow } from "../../../files/context-snapshot";
import { BUILTIN_DIFF } from "./builtin-diff-registry";
import { WindowVisible } from "../../../files/components/visible/resolveWindowVisible";
import { FallbackJsonDiff } from "../window-diff-renderers/FallbackJsonDiff"; // 保留的兜底
import { JsonFallback } from "../../../files/components/ContextSnapshotViewer"; // 若未导出则内联

export type WindowDiffKind =
  | { kind: "static"; key: string }
  | { kind: "before-after"; objectId: string }
  | { kind: "json" };

export function resolveWindowDiffKind(props: WindowDiffProps): WindowDiffKind {
  const type = props.current?.type ?? props.previous?.type;
  if (!type) return { kind: "json" };
  if (BUILTIN_DIFF[type]) return { kind: "static", key: type };
  return { kind: "before-after", objectId: type };
}

export function WindowDiff({ previous, current, sessionId }: WindowDiffProps & { sessionId?: string }) {
  const r = resolveWindowDiffKind({ previous, current });
  if (r.kind === "static") {
    const C = BUILTIN_DIFF[r.key];
    return <C previous={previous} current={current} />;
  }
  if (r.kind === "before-after") {
    // 复用线 A 的 WindowVisible 动态加载 object 自己的 visible/index.tsx，并列前/后
    return (
      <div className="window-diff-before-after">
        <div className="before">{previous ? <WindowVisible window={previous} jsonFallback={FallbackJsonDiff as any} sessionId={sessionId} /> : <em>（新增）</em>}</div>
        <div className="after">{current ? <WindowVisible window={current} jsonFallback={FallbackJsonDiff as any} sessionId={sessionId} /> : <em>（移除）</em>}</div>
      </div>
    );
  }
  return <FallbackJsonDiff previous={previous} current={current} />;
}
```
> `WindowVisible` 的 `jsonFallback` 签名是 `({window})`；这里传一个适配壳或复用 ContextSnapshotViewer 的 `JsonFallback`（若 module-private 则导出或内联一个 `({window}) => <pre>{JSON.stringify(window)}</pre>`）。`before-after` 的并列布局加最小 CSS（可后续 polish）。

- [ ] **Step 4: Run test to verify it passes**

Run: same as Step 2 — Expected: PASS (4 tests)。

- [ ] **Step 5: Commit**

```bash
git add packages/@ooc/web/src/domains/sessions/components/window-diff/
git commit -m "feat(window-diff): BUILTIN_DIFF 静态注册表 + resolveWindowDiff 四档回退"
```

---

## Task 4: LoopDiffView 接入 resolveWindowDiff

**Files:**
- Modify: `packages/@ooc/web/src/domains/sessions/components/LoopDiffView.tsx`（`renderDetail` :267-360；删 `import "./window-diff-renderers"` :31 / `getWindowDiffRenderer` :35 / file 专路 :272-291 / 其它 type 的 fetch+派发分支）

- [ ] **Step 1: Replace dispatch with WindowDiff**

`renderDetail` 改为：拿到 `entry`（含 previous/current）后，统一
```tsx
return (
  <DiffRendererErrorBoundary previous={entry.previous} current={entry.current} windowType={entry.type} windowId={windowId}>
    <WindowDiff previous={entry.previous as ContextWindow} current={entry.current as ContextWindow} sessionId={sessionId} />
  </DiffRendererErrorBoundary>
);
```
保留 `DiffRendererErrorBoundary`（兜底渲染异常）。**保留 file 不需 fetch 的快路**：file 走静态 `BUILTIN_DIFF.file`，其 fileDiff 来自 `entry.current.fileDiff`——确认 entry 仍带 fileDiff（来自 windowsSnapshot，`window-diff.helpers.ts:52-66`）。其它 type 原本要 fetch input.json 取 window 对象：**before-after 档需要完整 window 对象**——确认 `entry.previous`/`entry.current` 是否已是完整快照；若 snapshot 仅含精简字段，保留 fetch 逻辑填充 `previous`/`current` 再传 `WindowDiff`（见风险 #3）。

- [ ] **Step 2: Type-check + 删死码**

Run: `cd packages/@ooc/web && bunx tsc --noEmit`
Expected: 0 errors。删除对 `getWindowDiffRenderer`/per-type registry 的引用。

- [ ] **Step 3: Commit**

```bash
git add packages/@ooc/web/src/domains/sessions/components/LoopDiffView.tsx
git commit -m "refactor(window-diff): LoopDiffView 接 resolveWindowDiff,删 per-type 硬编码派发"
```

---

## Task 5: 迁移其余 8 个 diff 渲染器入 builtin（按 Task 2 exemplar）

逐个把 `window-diff-renderers/<Type>WindowDiff.tsx` 搬到对应 builtin 包 `<type>/visible/diff.tsx`，签名收敛 `({previous,current})`，先写"default export 是函数"的失败测试再搬。

- [ ] **Step 1: knowledge** — `KnowledgeWindowDiff` → `@ooc/builtins/knowledge/visible/diff.tsx`。
- [ ] **Step 2: search** — `SearchWindowDiff` → `@ooc/builtins/search/visible/diff.tsx`。
- [ ] **Step 3: program** — `ProgramWindowDiff` → `@ooc/builtins/program/visible/diff.tsx`。
- [ ] **Step 4: talk** — `TalkWindowDiff` → `@ooc/builtins/talk/visible/diff.tsx`。
- [ ] **Step 5: do** — `DoWindowDiff` → `@ooc/builtins/do/visible/diff.tsx`。
- [ ] **Step 6: plan** — `PlanWindowDiff` → `@ooc/builtins/plan/visible/diff.tsx`。
- [ ] **Step 7: relation** — `RelationWindowDiff` → `@ooc/builtins/relation/visible/diff.tsx`。
- [ ] **Step 8: method_exec** — `CommandExecDiff`（注册名 `method_exec`）→ 其 builtin 包 `visible/diff.tsx`（确认 method_exec 是否独立 builtin 包，否则放 `core/.../method_exec` 对应 visible 位）。
- [ ] **Step 9: 删 web 旧渲染器目录残留** — 删 `window-diff-renderers/{registry.ts,index.ts,<Type>WindowDiff.tsx}`；保留 `_shared.tsx`/`ErrorBoundary.tsx`/`FallbackJsonDiff.tsx`（被 builtin diff 组件 + resolver 复用，import 路径相应更新）。
- [ ] **Step 10: Run all** — `bun test packages/@ooc/builtins/ packages/@ooc/web/src/domains/sessions/` → PASS（迁现有渲染器测试 `<Type>WindowDiff.test.ts` 到 builtin 包并改 import）。

Commit each builtin: `feat(<type>): <Type>WindowDiff 迁入 visible/diff.tsx`。

---

## Task 6（增量，可后置）: 后端 client-source-url 寻址 visible/diff.tsx + 档 2 接入

**Files:**
- Modify: `packages/@ooc/core/app/server/modules/ui/api.client-source-url.ts:54-71`
- Modify: `resolveWindowDiff.tsx`（插入 `dynamic-diff` 档）

- [ ] **Step 1**: stone scope 加可选 `?file=diff` query：命中时 `absPath = join(visibleDir(stoneRef), "diff.tsx")`（默认仍 `index.tsx`）。worktree 路由复用 `resolveStoneIdentityRef`。加单测。
- [ ] **Step 2**: `resolveWindowDiffKind` user-defined 分支改为：先返回 `{kind:"dynamic-diff", objectId, sessionId}`；`WindowDiff` 的 dynamic-diff 档动态 `import` `clientSourceUrl("stone", objectId, {sessionId, file:"diff"})` 的 default，notFound（无 diff.tsx）时 **fall through 到 before-after 档**（复用线 A 动态加载的 notFound 回退模式）。
- [ ] **Step 3**: 单测加 user object 写了 `visible/diff.tsx` → 解析为 dynamic-diff；未写 → before-after。
- [ ] **Step 4: Commit** `feat(window-diff): user-defined object 自有 visible/diff.tsx 动态加载(档2)`。

> 后置判据：若用户暂不需要 user object 自定义 diff，档 3（before-after via visible）已覆盖 user object，可跳过 Task 6。

---

## Task 7: 概念文档收编（object.doc.ts）

**Files:**
- Modify: `packages/@ooc/meta/object.doc.ts`（visible 节点；`loop_timeline.patches.type_dispatch_diff_renderer`）

- [ ] **Step 1**: visible 节点补一句（精确简洁）：object 经 `visible/index.tsx` 掌控自身展示，经 **`visible/diff.tsx` 掌控自身"变化（diff）的展示"**；loop diff 视图统一按 window 解析到所属 object 的 diff 组件，回退链 = 自有 diff → 用自身 visible 渲前/后对照 → JSON。
- [ ] **Step 2**: 把 `type_dispatch_diff_renderer` patch 从"web 包按 type 注册 renderer"改述为"前端 `resolveWindowDiff` 解析到 object 自有 `visible/diff.tsx`（builtin 静态 / user 动态）"，锚 `resolveWindowDiff.tsx`。
- [ ] **Step 3**: `bun tsc --noEmit packages/@ooc/meta/object.doc.ts` → 0 errors（`DocTreeNode.sources` 单 entry 约束）。
- [ ] **Step 4: Commit** `docs(object.doc): visible 收编 diff 渲染(visible/diff.tsx + resolveWindowDiff)`。

---

## Task 8: 端到端验证

- [ ] **Step 1: builtin diff 不回归** — 启动 backend + 前端，打开 LoopTimeline，展开 file/talk/search/program 等 window 的 diff，确认与改造前视觉一致（file 仍是 codemirror 行级 merge）。
- [ ] **Step 2: user-defined before-after** — `_test_diff_<ts>` session：建 user object 写 `visible/index.tsx`，制造它的 window 在两 loop 间变化，确认 diff 视图落 before-after（两份 visible 并列），非裸 JSON。验证后清理 session。
- [ ] **Step 3: storybook gate** — `bun run test:storybook` → 0 FAIL（visible story 若涉及 diff 断言，更新为 resolver 行为）。
- [ ] **Step 4: Commit** `test(window-diff): loop diff 统一解析 e2e(builtin 不回归 + user before-after)`。

---

## Self-Review 结论

- ✅ 统一 diff 解析层，去 web 包 per-type 硬编码 — Task 3/4/5。
- ✅ object 拥有自身 diff 渲染（对称 visible/index.tsx）— Task 2/5 迁入 builtin。
- ✅ 回退链让 user object 有意义降级（before-after via visible，非裸 JSON）— Task 3 档 3。
- ✅ builtin→web 依赖与既有 visible/index.tsx 同模式（非新红线）— 接地已确认。
- ✅ 后端内容 payload（fileDiff）正交保留，diff 组件从 `current.fileDiff` 读 — Task 2。
- ⚠️ 命名一致性：`WindowDiffProps`/`BUILTIN_DIFF`/`resolveWindowDiffKind`/`WindowDiff` 跨 Task 引用须一致。
- ⚠️ 与线 A 命名对称：`resolveWindowVisible`↔`resolveWindowDiff`、`BUILTIN_VISIBLE`↔`BUILTIN_DIFF`、`WindowVisible`↔`WindowDiff`。

## 风险与未决

1. **diff vs visible 不对称（内容 payload）**：file 等内容级 diff 依赖后端 `current.fileDiff`（前端挖不出）。本计划不动后端 snapshot enrichment，diff 组件继续从 `current.fileDiff` 读；before-after 档（档 3）只渲 visible 两次、不做内容级 diff——对 user object 是合理降级，但不等价于语义 diff。
2. **client-source-url 只认 visible/index.tsx（:63）**：档 2（user 自有 diff.tsx）必须 Task 6 后端加 `?file=diff`。MVP 跳过档 2 不阻塞（档 3 兜住）。
3. **before-after 需完整 window 对象**：`LoopDiffView` 非 file type 原本 fetch input.json 取 window（:300+）；before-after 渲 `WindowVisible` 需完整 `previous`/`current`。确认 `entry.previous/current`（来自 windowsSnapshot）字段是否足够；不足则保留 fetch 填充。这是 Task 4 的实测点。
4. **codemirror/merge 进 builtin 包**：`file/visible/diff.tsx` import `@codemirror/merge`——与 `visible/index.tsx` import web 组件同模式，源码级 workspace 解析，无 package 边界问题（builtins 无独立 package.json）。
5. **大 window 的 before-after 体积**：档 3 并列两份完整 visible，对大 file 可能很长——可加折叠/限高 polish（非 MVP 阻塞）。

## Critical Files
- `packages/@ooc/web/src/domains/sessions/components/LoopDiffView.tsx`（派发点 :267-360）
- `packages/@ooc/web/src/domains/sessions/components/window-diff-renderers/*`（迁移源 + 保留 _shared/ErrorBoundary/FallbackJsonDiff/MarkdownBodyDiff）
- `packages/@ooc/web/src/domains/files/components/visible/resolveWindowVisible.tsx`（线 A 对称参照 + WindowVisible 复用）
- `packages/@ooc/web/src/domains/files/components/visible/builtin-visible-registry.tsx`（线 A 的 dirless-type 本地 import 范式）
- `packages/@ooc/builtins/<type>/visible/index.tsx`（迁入落点对称参照）
- `packages/@ooc/core/app/server/modules/ui/api.client-source-url.ts:54-71`（档 2 后端寻址）
- `packages/@ooc/meta/object.doc.ts`（visible/loop_timeline 收编）

---

## Review 修订（Supervisor 拍板，2026-06-08 技术 review 后）

技术 reviewer 实读源码后发现多处会让实现失败的硬伤。以下修订**优先于上文，实现时按此**。根因：上文过度宣称"与线 A 对称"——线 A 本身就不对称（无 builtin 目录的 type 留在 web），且从未把 input.json fetch 简化掉。

**C-1（阻塞）— 9 个 type 里只有 5 个有 builtin 目录。** `packages/@ooc/builtins/` 实存目录：file/knowledge/plan/program/search/skill_index/todo/custom/root/supervisor/user。**没有 talk/do/relation/method_exec**。所以 Task 3 的 `import TalkDiff from "@ooc/builtins/talk/visible/diff"` 等 4 个 import 解析不了（typecheck + bundle 双断）。**线 A 正是这样处理的**：`builtin-visible-registry.tsx:28-34` 把 `MethodExecWindowDetail`/`RelationWindowDetail`/`DoWindowDetail`/`TalkWindowDetail` 从 **web 本地文件** import（`method_exec` 注释明示其 builtin 包已删）。
> 修订：**迁入落点按 type 是否有 builtin 目录分流**——
> - file/knowledge/search/program/plan → `@ooc/builtins/<type>/visible/diff`（有目录）
> - talk/do/relation/method_exec → 留 web，放 `web/.../sessions/components/window-diff/<Type>Diff.tsx`，`BUILTIN_DIFF` 里**本地 import**（镜像 `builtin-visible-registry.tsx`）
> Task 2/5 的迁移目标、Task 3 的 import 路径据此改。**删除上文 Self-Review 里"builtin→web 依赖与既有 visible 同模式（接地已确认）"对全部 9 type 成立的断言**——只对那 5 个有目录的成立。

**C-2（阻塞）— `entry.previous/current` 是精简 `WindowSnapshotEntry`，不是完整 `ContextWindow`。** `window-diff.helpers.ts:50-77`：entry = `{id,type,contentHash,parentWindowId?,status?,compressLevel?,summary?,fileDiff?}`，**没有 content / transcript 等渲染所需字段**。现有 `LoopDiffView` 对非 file type 必须 fetch 当前+上一 loop 的 `input.json`、用 `extractWindowFromInput`（`:293-311`）取完整 window 再喂 renderer；只有 file 因后端把 `fileDiff` 附挂在 snapshot entry 上才免 fetch（`:211-214, 272-291`）。
> 修订：**保留 input.json fetch + extractWindowFromInput，不可删。** `WindowDiff` 对非 file type 接收**fetch 到的完整 window 对象**（`previousObj`/`currentObj`），不是 `entry`；file 走 entry 快路（带 fileDiff）。Task 4 的"统一调 WindowDiff、删 fetch"是错的，改为"统一渲染出口、但数据来源 file=entry / 其它=fetched window"。Task 1 的 `WindowDiffProps.previous/current` **类型放宽为 `unknown`（或 `ContextWindow | WindowSnapshotEntry`）**——现有 renderer 本就 `unknown` + 防御性 probe（`registry.ts:23-32`, `TalkWindowDiff.tsx:57-59`），不要强收成 `ContextWindow`。

**H-1（高）— `FallbackJsonDiff` 与 `WindowVisible.jsonFallback` 契约不兼容，`as any` 掩盖运行时崩。** `FallbackJsonDiff(props: {previous,current,windowType,windowId})`，`windowType`/`windowId` 必填（`registry.ts:23-32`, `FallbackJsonDiff.tsx:228`）；而 `WindowVisible` 调 jsonFallback 是 `<J window={window}/>`（`resolveWindowVisible.tsx:137-138`）。Task 3 的 `jsonFallback={FallbackJsonDiff as any}` 会用 `{window}` 调它、四个 prop 全错。
> 修订：给 before-after 档的 `WindowVisible` 传一个 **`({window}) => <pre>{JSON.stringify(window)}</pre>` 适配壳**（不是 FallbackJsonDiff）；json 兜底档直接用 `FallbackJsonDiff` 时**显式传 `windowType`/`windowId`**。删掉所有 `as any`。

**H-2（高）— `MarkdownBodyDiff.tsx` 是 8 个 renderer 的共享依赖，漏在保留清单。** 它被 search/do/talk/knowledge/program/relation/plan/method_exec 的 diff import，不是 `<Type>WindowDiff` 故不在 Task 5 step 9 保留名单 → 会被删，迁出的组件随即解析失败。
> 修订：保留清单加 **`MarkdownBodyDiff.tsx`**（及仍被存活测试引用的 `test-utils.ts`）。迁入 builtin 包的 diff 组件对它和 `_shared` 的 import 改为 `@ooc/web/src/...` 别名（深 import 别名可用——`file/visible/index.tsx:3` / `plan/visible/index.tsx:4-5` 已实证）。逐个审 `./_shared`/`./MarkdownBodyDiff` 相对 import 改别名。

**M-1（中）— builtin import 去 `.tsx` 扩展名。** 线 A 约定无扩展名（`builtin-visible-registry.tsx:20-27` `@ooc/builtins/file/visible/index`）。Task 2/3 的 `@ooc/builtins/file/visible/diff.tsx` 去掉 `.tsx` 成 `@ooc/builtins/file/visible/diff`。

**M-2（中，随 Task 6 可后置）— `?file=diff` 不能复用 index 的 legacy 回退。** 现 stone 分支 stat-miss 时回退 legacy `client/index.tsx`（`api.client-source-url.ts:62-71`）。`diff` 无 legacy 对应物，user object 没写 `diff.tsx` 必须**干净 404** 让前端落 before-after 档。
> 修订：`?file=diff` 走独立解析——stat `visibleDir/diff.tsx`，miss 即 404，**不接 legacy 回退**。

**Advisory — MVP 丢继承档需自觉标注。** 线 A resolver 还认 `effectiveVisibleType` 继承（`resolveWindowVisible.tsx:48-49,142-145`）；本 MVP 把所有 user-defined type 直接路由 before-after、不查继承。这是**有意的 MVP 收窄**（继承的 visible 渲前/后仍是合理降级），plan/doc 须显式记为"暂不对称"，勿误当完整对称。

> 净效果：架构（静态注册表 + resolver + 回退链 + builtin→web 深 import）经线 A 验证可行；硬伤全是 scope/数据形态错配，按上述修订即 implementable。
