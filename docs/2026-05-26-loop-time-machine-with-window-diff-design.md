# Loop Time Machine — Context Windows 时光机模式 + Window Diff 视图

**作者**：Supervisor（Claude Code 主会话）
**日期**：2026-05-26
**性质**：design 草稿（user 拍板后实施）
**触发**：user 决定把 Round 3 落地的 Loop Timeline 重构为"context windows 时光机"——左右按钮切换 loop + diff 视图（哪个 window 新增/删除/内容变更）；后端需给 window 加 hash 记到 debug 文件

---

## 1. 需求拆解

### 1.1 现状（Round 3 P1-3 已落地）
- `LoopTimeline.tsx` 按 loopIndex 升序排开（多 loop 全列）
- 每个 LoopEntry 显示 latency / messageCount / 关键 event chips
- 单击展开 → 嵌入 LLMInputJsonViewer（看 loop_NNNN.input.json 全文）
- 关键 event badge 可单击跳转 / approve permission_ask / 展开 events_summary

### 1.2 痛点
- "想看上一轮发生了什么变化"是高频需求，但**当前 UI 要肉眼对比两个展开的 input.json**——非常累
- LLM 视角下"context 变化"才是关键（哪个 window 加了、哪个改了、哪个删了），不是"原始 input.json 字符串 diff"
- 大 thread 时纵向列出 N 个 loop entry 占屏幕；时光机式"单次显示一个 loop"更聚焦

### 1.3 新形态目标
- **时光机导航**：左右按钮切换 loop（[← Prev] [→ Next] [Latest]）+ 顶部 mini timeline strip 总览
- **Window Diff 视图**：当前 loop 的 contextWindows 列表，每个 window 显示 vs 上一 loop 的状态：
  - 🆕 added（新窗口）
  - 🗑️ removed（已 close）
  - ✏️ changed（内容变更）
  - · unchanged（不变）
- **后端配合**：每个 window 算 contentHash，落 `loop_NNNN.meta.json`，前端按需 fetch 两个 loop 的 meta 做 diff
- **保留交互**：LoopEventBadge 高亮 / permission_ask 单击 approve / events_summary 展开 — 全部保留

---

## 2. 设计原则

### A. hash 是 debug 视角，不进 thread.json
- contentHash 是**派生字段**（每次写盘前算一次）
- 只写进 loop_NNNN.meta.json 的 `windowsSnapshot` 数组
- **不进 thread.json**——业务字段保持最小

### B. hash 算法简单优雅
- 用 `Bun.hash(JSON.stringify(stripVolatile(window)))`
- 64-bit number → toString(36) 编码（短）
- 不需要 type-dispatch（每个 type 自定义 hashContent 是过度设计；目标是"内容变没变"，不是"哪些字段变"）

### C. Diff 在前端算
- 后端只提供 windowsSnapshot 数组
- 前端拿 loop N + loop N-1 的 snapshot 对比：
  - id 在 N+1 有 + N 没有 → added
  - id 在 N 有 + N+1 没有 → removed
  - id 同 + hash 同 → unchanged
  - id 同 + hash 不同 → changed
- 不引入新 endpoint；扩展现有 meta.json shape 即可

### D. 时光机替换 LoopTimeline 主导航；其它交互保留
- 不重新发明 LoopEventBadge / LoopActionPopover / events_summary 处理
- 只是把"纵向列 N 个 loop entry"换成"一次显示一个 loop + 左右切换"
- 旧的 LoopEntry 内部展开（嵌入 LLMInputJsonViewer 等）作为 "View raw" 模式仍可用

### E. 退化：debug 未启用时
- 没 loop_NNNN.*.json → 没法做 hash diff
- 退化为 thread.events 时间序列展示（与 Round 3 退化模式同思路）
- 顶部提示"启用 debug 看完整 time machine"

### F. visibility-first 不破
- 时光机切换不引起任何 LLM 调用
- 所有数据派生自既有 debug 文件 + thread.events

---

## 3. 数据层设计

### 3.1 contentHash 算法

```ts
// src/observable/window-hash.ts (新)
import { stripVolatileWindow } from "@src/persistable/thread-json";

export function computeWindowContentHash(window: ContextWindow): string {
  // 1. 剥离 in-process 字段 (与 stripVolatileForPersist 同款)
  const stripped = stripVolatileWindow(window);
  // 2. JSON stringify 后 hash
  const json = JSON.stringify(stripped, Object.keys(stripped).sort());  // 稳定 key 序
  return Bun.hash(json).toString(36);
}
```

⚠️ **key 排序**：用 `Object.keys(stripped).sort()` 保证字段顺序稳定；否则 V8 字段顺序变化导致 hash 漂移。

⚠️ **stripVolatileWindow**：需要新加导出（thread-json.ts 当前可能没有单 window 的 strip 函数；只有整 thread 的）。**实施时确认**。

### 3.2 落盘 — 扩展 loop_NNNN.meta.json

`LlmLoopDebugMetaRecord`（src/persistable/debug-file.ts）当前包含 `provider/model/latencyMs/messageCount/toolCount/...`。**扩展**：

```ts
export type WindowSnapshotEntry = {
  id: string;
  type: string;          // file / talk / do / plan / search / ...
  contentHash: string;
  parentWindowId?: string;
  status?: string;
  compressLevel?: 0 | 1 | 2;
};

export type LlmLoopDebugMetaRecord = {
  // ... 现有字段
  windowsSnapshot?: WindowSnapshotEntry[];  // 新加 (optional 向后兼容)
};
```

写入点：`captureContextSnapshot` 或 `writeLoopDebugMeta`（找到现有 loop meta 落盘点；附加 windowsSnapshot 字段）。

### 3.3 不进 thread.json

- thread.contextWindows[].sharing / status / 各种字段保持不变
- contentHash **永远不写进 thread.json**——只在 debug 落盘路径上算一次

---

## 4. 前端组件分解

### 4.1 重命名 / 重构

- `LoopTimeline.tsx` → 重构内部主体为时光机；**保留文件名**（避免破坏 import）；改名为 `LoopTimeline` 即可（语义包含 timeline + machine）
  - 或：新建 `LoopTimeMachine.tsx`，把 LoopTimeline 改为浅 wrapper

**倾向**：保留 `LoopTimeline.tsx` 文件名，内部重构（避免大量 rename 散落各处）。

### 4.2 组件结构

```
web/src/domains/sessions/components/
├── LoopTimeline.tsx                  ← 主组件（重构内部为时光机）
├── LoopNavigator.tsx                 ← 新：左右切换按钮 + loop 编号 + Latest 按钮
├── LoopMiniTimeline.tsx              ← 新：顶部 mini timeline strip（点击跳 loop）
├── LoopDiffView.tsx                  ← 新：当前 loop windows diff
├── WindowDiffRow.tsx                 ← 新：单 window diff row（含 added/changed/removed/unchanged 标记）
├── LoopEntry.tsx                     ← 保留：用作 "View raw" 模式（折叠后的详情）
├── LoopEventBadge.tsx                ← 保留：关键 event badge
├── LoopActionPopover.tsx             ← 保留：permission/summary 弹层
└── LoopTimeline.test.ts              ← 改：单测覆盖时光机 + diff 逻辑
```

### 4.3 视觉 / 交互布局

```
┌──────────────────────────────────────────────────────┐
│ Loop Time Machine                          [View raw]│
│ ──────────────────────────────────────────────────── │
│ ◯─◯─●─◯─◯─◯─◯─◯─◯─◯ ...                            │ ← mini timeline
│        ^                                              │
│  Loop #0023 of 50    [← Prev] [Next →] [⏭ Latest]   │
│  12:34:56 · 1.2s · 8 messages · 3 tools              │
│ ──────────────────────────────────────────────────── │
│ Windows (vs Loop #0022):                              │
│                                                      │
│ 🆕 file_window  src/foo.ts        added              │
│ ✏️ talk_window  → supervisor      changed (hash diff)│
│ · do_window    plan1              unchanged          │
│ 🗑️ search_window grep "TODO"       removed (closed)  │
│ · plan_window  "重构 thinkable"    unchanged          │
│                                                      │
│ Click any window → expand & show full content        │
│                                                      │
│ ─── Key events in this loop ───────────────────────  │
│ ⏸️ permission_ask: write_file → docs/...             │
│ 🗜️ context_compressed (idle-fold, 3 windows)         │
└──────────────────────────────────────────────────────┘
```

### 4.4 单击 window → 展开
- 折叠态：仅一行（icon + type + summary + diff status）
- 展开态：嵌入 LLMInputJsonViewer 或 ContextSnapshotViewer 看该 window 完整内容
  - 复用现有 LLMInputJsonViewer / ContextSnapshotViewer，不重写

### 4.5 LoopNavigator 行为

- `←` Prev：跳到 loop N-1
- `→` Next：跳到 loop N+1
- `⏭ Latest`：跳到最新 loop（max loopIndex）
- 键盘快捷键：←/→（焦点在主组件时）
- 边界：loop 0 时 Prev disabled；最新时 Next disabled

### 4.6 LoopMiniTimeline 行为

- 显示所有 loop 的点（loopIndex 0..N）
- 当前 loop 高亮（蓝色实心）
- 关键 event 在某 loop → 该点上加小角标（compress=蓝点 / permission_ask=黄点）
- 单击某点 → 跳到该 loop
- loop 多时（>30）横向滚动 + 当前 loop 自动 scroll into view

### 4.7 URL 状态

复用现有 routing（`?selected=thread:<obj>:<tid>`）+ 新增：
- `?loop=<N>` query param 表示当前查看的 loop 编号
- 不传 = 默认显示 Latest
- 刷新可保留

### 4.8 退化模式

debug 未启用时：
- mini timeline strip：不显示（无 loop 数据）
- LoopNavigator：disabled
- 主区：渲染 thread.events 时间序列（与 Round 3 退化模式一致）
- 顶部 banner：`"Loop debug 未启用，仅显示事件序列。[启用 debug]"`

---

## 5. 实施分阶段

| Phase | 工作量 | 范围 | 派单 |
|---|---|---|---|
| **E1** | 小 | meta 加 `visible.loop_timeline` 的 patches.time_machine + observable.debug_files 加 windowsSnapshot 字段说明 | Supervisor 直写 + tsc clean |
| **E2** | 中 | backend: window-hash.ts + 扩展 LlmLoopDebugMetaRecord + 在 captureContextSnapshot/writeLoopDebugMeta 处计算并写入 + 单测 | AgentOfObservable + AgentOfPersistable |
| **E3** | 中-大 | frontend: 重构 LoopTimeline 为时光机 + LoopNavigator/MiniTimeline/DiffView/WindowDiffRow + 保留 LoopEventBadge/LoopActionPopover 路径 + 退化模式 + 单测 | AgentOfVisible |
| **E4** | 小 | e2e 验证（用 fixture meta.json 模拟 N+1 loop 的 hash 变化 → 断言 UI 渲染 added/changed/removed/unchanged）| 同 E3 sub agent 自带 |

E2 与 E3 文件域不重叠，可并行。

---

## 6. 不变量

| 不变量 | 说明 |
|---|---|
| **contentHash 不进 thread.json** | 只在 debug 落盘路径上算；业务字段保持最小 |
| **hash 算法稳定** | stripVolatile + 排序 key + Bun.hash —— 同 content 必同 hash |
| **type-agnostic hash** | 不为每个 type 写 hashContent；全用统一 JSON hash |
| **diff 在前端算** | 后端只提供 windowsSnapshot 数组；diff 算法 client-side |
| **退化优雅** | debug 未启用时仍可看 thread.events |
| **现有交互保留** | LoopEventBadge / LoopActionPopover / events_summary 路径全保留 |
| **agent-native parity 预留** | 后端 windowsSnapshot 是 raw data；未来 Agent 调 server method 自查 diff 也用同源数据 |

---

## 7. 风险

| 风险 | 缓解 |
|---|---|
| hash 算法在 Node/Bun 版本不同时漂移 | Bun.hash 是 stable API（Bun.js 文档承诺）；不同 bun 版本应一致；测试覆盖 |
| 大 window（如 file_window 含 10KB 内容）JSON.stringify 性能 | 单 loop 内 < 30 windows × 平均 5KB = 150KB stringify；< 1ms；OK |
| mini timeline 在 100+ loop 时拥挤 | 横向滚动 + 当前 loop scroll-into-view；建议 loop > 50 时隐藏远处点（折叠"... 30 earlier loops ..."）|
| 用户切换太快导致 fetch 风暴 | LoopNavigator 加 debounce 200ms |
| 旧 e2e（loop-timeline 风格）依赖纵向列出多 loop entry | 改测试断言为时光机形态；旧断言只能匹配"first loop entry"等 simple 模式 |
| meta.json 中 windowsSnapshot 是 optional；旧 loop 没这字段 | 前端处理：N 没有 snapshot → diff 显示 "First loop with snapshot data" 占位 |

---

## 8. 与 Round 1-8 的接口

- **接 P0-2 (compress)**: WindowSnapshotEntry 含 `compressLevel`；diff 视图可显示"window compressed (level 0 → 1)"作为 change 类型
- **接 P0-1 (permission)**: LoopActionPopover 仍可在某 loop 触发 permission_ask 时单击 approve；与时光机正交
- **接 P1-3 (loop visualizer)**: 本设计 = P1-3 的演进
- **接 plan_window (Round 7)**: plan_window 是 ContextWindow，自然进 windowsSnapshot；diff 可看出 plan_window 的 hash 变化（add_step / update_step）
- **不动 Round 8 SessionThreadsIndex**: 时光机是 thread 详情页 tab，不动 user home

---

## 9. 待用户拍板

1. **本轮直接实施 E1-E4 全套**？还是只交付 design 等下一轮拍板？
2. **mini timeline 在大量 loop 时的折叠策略**：横向滚动（推荐 MVP）/ 智能折叠"... earlier loops ..."（增强）？
3. **保留 LoopEntry 作为 "View raw" 模式**：是/否？还是完全废弃（diff 视图已足够）？
4. **hash 算法**：Bun.hash (推荐) / SHA-1 / 其它？

---

## 10. 验收

最终交付要满足：
1. 进入任一 thread 详情页 → 切到 Loop Time Machine tab → 显示最新 loop + mini timeline strip
2. 单击 ← / → 切换 loop；URL 同步更新 `?loop=N`
3. 每个 window 显示 diff status（added/changed/removed/unchanged）+ 视觉差异
4. 单击 window → 展开看完整内容
5. 关键 event 在当前 loop → LoopEventBadge 在底部显示
6. 单击 permission_ask badge → LoopActionPopover 弹出 approve/reject
7. debug 未启用 thread → 退化模式（事件序列 + 启用按钮）
8. e2e 覆盖：构造 3 个 loop 的 meta.json with 不同 windowsSnapshot → 切换断言 diff 标记
9. backend 单测：computeWindowContentHash 同 content 同 hash / 不同 content 不同 hash / stripVolatile 字段不影响
10. 不破坏 Round 3 P1-3 现有功能（permission approve / events_summary 全可用）

---

## 历史

- **2026-05-26**：首版。Round 9 design 草稿。
