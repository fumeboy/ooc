# Type-Dispatch Window Diff View — 每种 Window 类型自渲染 Diff

**作者**：Supervisor（Claude Code 主会话）
**日期**：2026-05-27
**性质**：design 草稿（user 拍板后实施）
**触发**：Round 9 Time Machine 已落 4 态 diff，但展开看内容时所有 type 都嵌 `LLMInputJsonViewer` 全文；用户要求"为每种 window type 设计 diff view"，**file_window 用 `@codemirror/merge` 双侧 diff**

---

## 1. 现状

### Round 9 LoopDiffView 行为
- 折叠态：`WindowDiffRow` 显示 icon + type + summary + diff status（added/changed/removed/unchanged）✅
- **展开态**：所有 type 一律嵌 `LLMInputJsonViewer` 看 `loop_NNNN.input.json` 全文 ❌
- 用户看 "changed" 想看 **真正的内容 diff**，不是"两份 JSON 字符串靠肉眼对"

### 痛点
- changed 状态展开 → 仍要肉眼找差异
- file_window 改了 100 行 → 看 input.json 完全不可读
- talk_window 加了 2 条消息 → 找半天哪条新加
- plan_window 改了 step.status → 找哪个 step 变了

---

## 2. 设计原则

### A. Type-Dispatch（与 OOC 哲学一脉相承）
- renderXml / compressView / contentHash 都是 type-dispatch
- **`renderDiff` 也走 type-dispatch**：每个 type 注册自己的 diff renderer
- 未注册 type → fallback 到 LLMInputJsonViewer 全文（当前行为；向后兼容）

### B. 前端 type-dispatch（不动 backend）
- diff 算法在前端跑（拿 N + N-1 的 input.json 提取该 window）
- backend 不需新增字段（windowsSnapshot 提供 hash; input.json 提供完整内容）
- 注：renderDiff 是 **web/ 内** 的 dispatch，不是 backend 的 WindowTypeDefinition.renderXml/compressView 那种 backend hook

### C. file_window 用 CodeMirror Merge
- 库：`@codemirror/merge`（web/package.json 已含 ^6.0.0）
- 形式：左侧 prev / 右侧 current（unified 或 split 视图）
- 二进制文件退化：显示 "binary content — diff not available"

### D. 其它 type 用最适合的 diff 形态
- talk_window：消息级 diff（新消息绿底 / 删除 strike / 修改 inline diff）
- do_window：child status 变化 + transcript 消息 diff
- plan_window：step-level diff（add/remove/status change/sub plan link change）
- search_window：match 集合 diff（新命中 / 移除命中）
- knowledge_window：markdown body 文本 diff（CodeMirror Merge 复用）
- program_window：执行历史 diff（新增 exec / 新增 output）
- command_exec：args 字段 diff（refine 累积）
- relation_window：markdown 双 scope diff
- root：永不 diff（语义不合理）
- command_exec：args 字段 diff
- skill_index：不 diff（每轮派生，hash 几乎稳定）

### E. 不破坏现有功能
- LLMInputJsonViewer 仍可用（fallback + 切换查看）
- LoopActionPopover / LoopEventBadge 不动
- WindowDiffRow 折叠态外观不变

### F. observable 视角（visibility-first）
- 每个 type 的 diff 都让 LLM/用户**一眼看到变化**（不藏 / 不让肉眼比对）
- 字段级 / 步骤级 / 行级颗粒度
- 错误优雅：renderer 抛错 → fallback 到 JSON 全文 + 错误 hint

---

## 3. 架构

### 3.1 注册机制（web 端）

```ts
// web/src/domains/sessions/components/window-diff-renderers/registry.ts
export type WindowDiffRenderer = (props: {
  previous: any | undefined;   // loop N-1 input.json 中该 window 的完整内容
  current: any | undefined;    // loop N input.json 中该 window 的完整内容
  windowType: string;
  windowId: string;
}) => React.ReactNode;

const REGISTRY = new Map<string, WindowDiffRenderer>();

export function registerWindowDiffRenderer(type: string, renderer: WindowDiffRenderer): void;
export function getWindowDiffRenderer(type: string): WindowDiffRenderer | undefined;
```

每个 type 的 renderer 是独立 .tsx 文件：

```
web/src/domains/sessions/components/window-diff-renderers/
├── registry.ts                       ← 注册机制
├── FileWindowDiff.tsx                 ← CodeMirror Merge
├── TalkWindowDiff.tsx                 ← 消息级 diff
├── DoWindowDiff.tsx                   ← child status + transcript
├── PlanWindowDiff.tsx                 ← step-level diff
├── SearchWindowDiff.tsx               ← match 集合 diff
├── KnowledgeWindowDiff.tsx            ← markdown 文本 diff (CodeMirror Merge)
├── ProgramWindowDiff.tsx              ← 执行历史 diff
├── CommandExecDiff.tsx                ← args 字段 diff
├── RelationWindowDiff.tsx             ← markdown 双 scope diff
├── FallbackJsonDiff.tsx               ← 通用 JSON tree diff (高亮变化字段)
└── index.ts                           ← 集中 import + register 所有 renderer
```

`index.ts` 在被 import 时（side-effect）注册所有 renderer。LoopDiffView 在文件顶部 `import "./window-diff-renderers"` 触发注册。

### 3.2 数据提取（前端）

LoopDiffView 现已 fetch `runtimeGetLoopDebug(N)` 拿 input.json。**扩展为同时 fetch N 和 N-1**，从两份 input.json 的 contextSnapshot.contextWindows 中按 windowId 提取该 window 的完整对象，传给 renderer。

```ts
// 展开某 window 时
const [currentInput, previousInput] = await Promise.all([
  fetchLoop(currentLoopIndex),
  previousLoopIndex !== undefined ? fetchLoop(previousLoopIndex) : Promise.resolve(undefined),
]);
const previous = previousInput
  ? extractWindowFromInput(previousInput.input, windowId)
  : undefined;
const current = extractWindowFromInput(currentInput.input, windowId);
const Renderer = getWindowDiffRenderer(windowType) ?? FallbackJsonDiff;
return <Renderer previous={previous} current={current} windowType={windowType} windowId={windowId} />;
```

### 3.3 added/removed 路径

- **added**：previous=undefined，renderer 显示"全新加入"+ 完整内容（CodeMirror 单侧 / 列表全绿）
- **removed**：current=undefined，renderer 显示"已 close" + 上一 loop 的内容快照
- **changed**：双侧 diff
- **unchanged**：用户通常不会展开，但若展开 → renderer 显示单份内容

### 3.4 错误处理

每个 renderer 内部 try-catch；抛错时 fallback：
```tsx
<ErrorBoundary fallback={<FallbackJsonDiff previous={previous} current={current} ... />}>
  <SpecificRenderer ... />
</ErrorBoundary>
```

ErrorBoundary 显示一行 "diff renderer error: <msg> — showing JSON tree fallback"。

---

## 4. 每个 Type 的 Diff 视图详细设计

### 4.1 file_window（用 CodeMirror Merge）

数据形态：
```ts
{
  type: "file";
  path: string;
  status: "open" | "closed";
  lines?: [number, number];
  content?: string;   // 实际文件内容（可能不在 window 上而在 ContextSnapshot 渲染时填）
}
```

⚠️ **关键问题**：file_window 在 thread.contextWindows 里**不一定包含完整 content**（按 OOC 现状，content 是渲染时从 fs 读，不持久化）。需要确认 input.json 的 contextSnapshot 中是否含 content。

**应对策略**：
- 优先从 input.json contextSnapshot 中提取 content（如有）
- 没有则从 path 通过 `/api/tree/file` 拿当前文件 — 但只能拿当前内容，prev 内容拿不到
- 退化：仅显示 path + 提示"content not in snapshot"

🚨 这个 sub agent 实施时必须先**实验 input.json 中 file_window 的 shape**，决定数据来源。

CodeMirror Merge 用法：
```tsx
import { MergeView } from "@codemirror/merge";
// 或：import CodeMirrorMerge from "@uiw/react-codemirror"  // 看是否有 merge wrapper

<CodeMirrorMerge
  original={previous.content ?? ""}
  modified={current.content ?? ""}
  extensions={[...]}
  orientation="a-b"  // 左右双侧
/>
```

二进制 / 大文件：>200KB or 非 text → 显示 "binary or too large — diff not shown" + path link。

### 4.2 talk_window

数据形态：
```ts
{
  type: "talk";
  target: string;
  targetThreadId?: string;
  transcript: Array<{ from: string; text: string; createdAt?: number; id?: string }>;
  status: ...;
}
```

Diff 形态：
- 上方：target / status 字段 diff（如 status 从 open → closed）
- 主体：消息列表（按 createdAt 排序）
  - 新增消息：绿底 🆕
  - 修改的消息：黄底 + 显示 inline diff（理论上很罕见）
  - 删除的消息：strike-through
  - 不变的消息：普通
- 用 message.id（如有）配对，无 id 则按 index 配对

### 4.3 do_window

数据形态：
```ts
{
  type: "do";
  target: string;        // child thread id 或 child task id
  targetThreadId?: string;
  status: "running" | "waiting" | "done" | "archived" | ...;
  transcript: ...;
}
```

Diff 形态：
- 顶部：child status 变化（如 "running → done" 用大字号 + 颜色）
- 中部：transcript diff（与 talk_window 类似）
- 底部：sharing 状态变化（如 "live → lent_out"）

### 4.4 plan_window

数据形态（Round 7）：
```ts
{
  type: "plan";
  title: string;
  description?: string;
  steps: Array<{ id; text; status; subPlanWindowId? }>;
  status: "active" | "done" | "archived";
}
```

Diff 形态：
- title / description 文本 diff
- steps 列表 step-level diff（按 step.id 配对）：
  - added step：绿底 🆕
  - removed step：strike
  - status change：黄底 + "pending → done" 等
  - text change：inline diff
  - subPlanWindowId change：显示"sub plan link added/removed"

### 4.5 search_window

数据形态：
```ts
{
  type: "search";
  kind: "glob" | "grep";
  query: string;
  matches: Array<{ path: string; line?: number; snippet?: string }>;
  status: ...;
}
```

Diff 形态：
- query 字段 diff（一般不变）
- matches 集合 diff（按 path+line 配对）：
  - 新命中 / 移除命中 / 同位置 snippet 变化

### 4.6 knowledge_window

数据形态：
```ts
{
  type: "knowledge";
  path: string;
  frontmatter?: object;
  body: string;
  status: ...;
}
```

Diff 形态：
- frontmatter 字段 diff（JSON tree）
- body 文本 diff（**复用 CodeMirror Merge**，markdown 语法高亮）

### 4.7 program_window

数据形态：
```ts
{
  type: "program";
  language: "shell" | "ts" | "js" | ...;
  history: Array<{ code: string; output?: string; status: "running" | "ok" | "error"; startedAt }>;
  status: ...;
}
```

Diff 形态：
- 新增 exec 调用：绿底 + 显示 code + output
- 不变历史：折叠 + count
- 修改历史（极罕见）：fallback JSON

### 4.8 command_exec

数据形态：
```ts
{
  type: "command_exec";
  command: string;
  args: object;          // refine 中累积
  result?: ...;
  status: "open" | "submitted" | ...;
}
```

Diff 形态：
- args 字段级 diff（key-by-key）
- result 字段 diff
- status 变化

### 4.9 relation_window

数据形态：
```ts
{
  type: "relation";
  peer: string;
  scope: "object" | "session";
  body: string;          // markdown
  status: ...;
}
```

Diff 形态：复用 CodeMirror Merge 显示 body 文本 diff。

### 4.10 root / skill_index / todo

- root: 永不 diff（语义不合理）— renderer 返回 null
- skill_index: 每轮派生不持久化；hash 通常稳定；如改变（skill 文件改）→ 用 FallbackJsonDiff
- todo: 暂未深入，先 FallbackJsonDiff

### 4.11 custom（用户自定义 stone object window）

- type 名是任意 stone 自定义的 type
- 未注册 → FallbackJsonDiff（通用 JSON tree diff）

---

## 5. FallbackJsonDiff（通用）

未注册 type / renderer 抛错 / 数据缺失时统一兜底：
- 用通用 JSON tree 展示 previous / current（左右双栏）
- 字段级高亮变化（绿背景=added / 红背景=removed / 黄背景=changed）
- 实现简单：递归 diff 两个 object，渲染 colorized JSON tree

---

## 6. 数据获取扩展

LoopDiffView 当前 fetch 单 loop input.json。**新行为**：
- 展开时同时 fetch 当前 + 上一 loop 的 input.json
- 缓存：keyed by loopIndex（避免切换 window 时重复 fetch）
- 上一 loop 不存在（loop 0 / previous undefined）→ previous 传 undefined

```ts
// 简单 cache（component lifetime）
const loopCache = new Map<number, any>();
async function getLoopInput(idx: number) {
  if (loopCache.has(idx)) return loopCache.get(idx);
  const res = await fetch(...);
  loopCache.set(idx, res.input);
  return res.input;
}
```

---

## 7. 实施分阶段

| Phase | 工作量 | 范围 | 派单 |
|---|---|---|---|
| **F1** | 小 | meta 加 `visible.loop_timeline.patches.type_dispatch_diff_renderer` 子 patch 说明协议 + 类型分发表 | Supervisor 直写 |
| **F2** | 中 | web/ 注册机制 + FallbackJsonDiff + file_window CodeMirror Merge + LoopDiffView 改用 dispatch（含数据 fetch 扩展）+ ErrorBoundary | sub agent |
| **F3** | 中-大 | 其它 type renderer（talk / do / plan / search / knowledge / program / command_exec / relation）+ 单测 | sub agent (并行 F2 之后) |
| **F4** | 小 | 视觉冒烟 + commit | 自带 |

⚠️ **F2 优先**：file_window CodeMirror Merge 是用户直接点名的；先把"框架 + 一个真实例子"立起来，F3 再补全。

---

## 8. 不变量

| 不变量 | 说明 |
|---|---|
| Type-dispatch | 每 type 自己 renderer；新 type 加 renderer 不动主框架 |
| 前端 only | 不动 backend；不引入新 endpoint |
| Fallback 优雅 | 未注册 type / 抛错 → JSON tree diff（visibility-first） |
| 不破坏现有 | LLMInputJsonViewer / WindowDiffRow 折叠态 / LoopActionPopover 全保留 |
| 数据来源稳定 | 全部从 `runtimeGetLoopDebug(N).input.json` 派生；不引入新 API |
| 性能 | 单 window 展开时才 fetch；切换 window 用 cache；切 loop 重置 cache |

---

## 9. 风险

| 风险 | 缓解 |
|---|---|
| file_window content 不在 contextSnapshot 里 | F2 实施时先验数据 shape；不在则 fallback "content not in snapshot" + path link |
| CodeMirror Merge SSR / 大文件渲染慢 | 限制 >200KB 不渲染；MergeView 在 useEffect 内 mount（非 SSR）|
| 各 type shape 与 design 推测不符 | F2/F3 sub agent 先验真实 input.json 中 window 的 shape |
| 字段 diff 视觉杂乱（plan 5 step + 子 plan）| 限制单层渲染 step；sub plan 显示链接而非展开 |
| ErrorBoundary 错误吞噬 | error 显示 "renderer X failed: <msg>" + fallback 不静默 |

---

## 10. observable / visibility 视角

- 每个 type 的 diff 都让"变化"成为视觉信号（不藏在 hash 里）
- console.warn 错误时打 renderer name + window id（方便调试）
- 每个 renderer 单测覆盖 added/removed/changed/unchanged 4 态
- design doc 内的 type 表是权威；缺一个 type 不实现 → ErrorBoundary 兜底，但 design doc 标 "未实施"

---

## 11. 验收

1. file_window 类型 changed → 展开看到 **CodeMirror Merge** 左右双栏 diff（行级高亮）
2. talk_window 类型 changed → 展开看到消息列表 diff（新消息绿底）
3. plan_window changed → step 级 diff（status / text / sub plan link 变化标记）
4. 未注册 / custom type → FallbackJsonDiff（JSON tree + 字段着色）
5. file_window content 不在 snapshot → 优雅退化 + path link
6. 所有 renderer 单测覆盖 4 态
7. LLMInputJsonViewer / LoopActionPopover / WindowDiffRow 折叠态视觉不变

---

## 12. 待用户拍板

1. **F2 + F3 一次性派**（一个 sub agent 全包）/ 分两次（F2 先 file + 框架，F3 再补全）？
2. **file_window content 数据来源**（如果 input.json 没含 content）：
   - 选 A：放弃（path 显示 + "content not in snapshot"）
   - 选 B：要求后端在 contextSnapshot 中携带 content（要 backend 改）
   - 选 C：前端临时 fetch `/api/tree/file` 拿当前 path 的内容（但 prev 内容仍拿不到）
3. **CodeMirror Merge orientation**：split 双栏 / unified 单栏？

---

## 历史

- **2026-05-27**：首版。Round 10 design 草稿。
