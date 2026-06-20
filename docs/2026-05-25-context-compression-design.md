# OOC 上下文压缩 — 基于 ContextWindow 的多层衰减设计

> ⚠️ **已被取代（2026-06-20）**：本文是早期草稿，把 compress 设想为 **tool 原语** + 多层自动衰减。
> 实际方向改为 **compress 是 window method（非原语）**，稳定原语恒 3 个（exec/close/wait）。
> 完整现状见 `docs/2026-06-20-compress-overview.md`；设计权威见对象树 `thinkable/knowledge/compress.md`。
> 本文仅留作历史。

**作者**：Supervisor（Claude Code 主会话）
**日期**：2026-05-25
**性质**：design 草稿（未落 `meta/object.doc.ts`，未动 `src/`）
**前置阅读**：`docs/2026-05-25-ccb-observation.md` § 缺口 C
**预留代码点**：
- `src/thinkable/llm/types.ts:5` — `LlmToolName = "exec" | "close" | "wait" | "compress"`（compress 已留位）
- `src/executable/tools/index.ts:21` — `OOC_TOOLS` 暂不含 compress
- `meta/object.doc.ts:464` — `thinkable.tools.todo` 写明"等待策略与触发时机定义后落地"

---

## 1. 重新定义问题：OOC 的 context ≠ 线性字符串

CCB 用三层 compaction（Session Memory / API summaries / MicroCompact）解决"一段超长 chat history"。OOC 没这个问题——OOC 的上下文是**结构化的对象集合**：

```
ThreadContext = {
  contextWindows: ContextWindow[]   ← 信息层（结构化）
  events:        ProcessEvent[]      ← 历史层（时间序列）
  knowledge:     KnowledgeEntry[]    ← 已渐进激活（已自压缩）
  inbox/outbox:  ThreadMessage[]
  plan / threadLocalData / ...
}
```

把 CCB 思路直接套到 OOC 是错的：套不上，且会破坏 OOC 的「window 是 first-class object」哲学。

**OOC 的压缩必须按 OOC 自己的本性来设计。**

### 1.1 Token 压力来源（穷举）

| 来源 | 增长模式 | 已有控制 | 缺口 |
|---|---|---|---|
| **contextWindows 数量** | thread 持续 open 各种 window 不 close | `close` tool，window onClose hook | LLM 经常忘 close，无强制 |
| **单 window 内容体积** | file_window 读 10K 行 / search_window 500 命中 / talk transcript 长 | 部分 type 已有分页（file range）| 多数 type 没有"折叠"中间态 |
| **events 累积** | 每轮 ThinkLoop +4~10 个 ProcessEvent | 无 | 整个流无任何收纳 |
| **knowledge 注入** | 命中 command path 即加载正文 | `activates_on` 渐进激活 + `command_exec` 关闭时回收 | ✅ 已控 |
| **inbox/outbox** | talk_window 消息累积 | 无 | 长会话退化 |
| **cross-window 重复** | 同文件多次 open 不同 range | 无 | LLM 不知不觉双倍占用 |

**结论**：events 与单 window 体积是两个**未管理**的主大头；contextWindows 数量靠 LLM 自律 close（已有协议但弱）。

---

## 2. 设计原则

### 原则 A：每个 window type 自负责自己的压缩（type-dispatch）
和 `WindowTypeDefinition.renderXml` 一样，每个 type 注册 `compressView(level)` hook。**绝不让一个全局算法去压所有东西**——那是 CCB 的做法，因为它没有 type 系统。

### 原则 B：压缩 = 状态机的一档，不是"删除"
window 不被压缩 = 信息消失，而是进入**收纳态**：title + 元信息 + 一条"如何展开"的提示仍可见。LLM 想细看就 `exec(window_id, "expand")`。

### 原则 C：LLM 主动 + 自然衰减 + 紧急兜底，三路并行
| 触发路径 | 谁触发 | 时机 |
|---|---|---|
| **主动** | LLM 调 `compress` tool | LLM 自觉判断"context 太杂"或看到 budget meter 告警 |
| **自然衰减** | 系统按 window status / age 自动 collapse | window 进入 `done` / `idle` 状态后 N 轮 |
| **紧急兜底** | ThinkLoop 在 buildContext 前发现超 budget | 兜底自动 collapse 旧的、低优先 window |

### 原则 D：可逆 — 一切压缩都有 `expand` 命令
LLM 决定"我之前压缩错了"时能恢复。如果某 window 已经从内存中真删了（紧急兜底极端情况），expand 命令 fallback 到从 persistence 读回——和 stone-versioning / pool 复用同一条路。

### 原则 E：events 流单独治理
events 不是 window，套不上 type-dispatch。events 走独立的 **ring buffer + 摘要快照** 协议（见 §4.2）。

### 原则 F：silent-swallow ban 仍然有效
**压缩必须可见**：每次 compress 在 events 流写一条 `context_compressed` ProcessEvent，LLM / debug / UI 都能看见发生了什么。

---

## 3. 三层模型（OOC 版）

把 CCB 三层重新映射到 OOC：

```
CCB 层级            OOC 对应                                      粒度
─────────────────────────────────────────────────────────────────────
Session Memory   → events 摘要快照（events.summarize_old）       全局粗
API summaries    → window-typed compressView hook                单 window 中
MicroCompact     → window 状态自然衰减（status → fold）          单 window 字段细
```

每一层都对应 OOC 已有的结构化概念，不需要"线性会话摘要"这种破坏对象哲学的东西。

---

## 4. 具体机制

### 4.1 Window 压缩三档（compressLevel: 0 | 1 | 2）

每个 `WindowTypeDefinition` 注册：

```ts
compressView?: (window: ContextWindow, level: 1 | 2, ctx: RenderCtx) => XmlNode[] | Promise<XmlNode[]>
```

| Level | 语义 | 默认行为（无 hook 时）|
|---|---|---|
| **0** | live / 完整渲染 | 当前 renderXml 直出 |
| **1** | folded / 折叠态 | 仅渲染 `<title>` + `<summary>` + `<commands hint="expand">` |
| **2** | snapshot / 仅元信息 | 仅 `<title>` + `<status>` + 持久化指针 |

#### 各 window type 的建议 compressView

| Type | Level 1 (folded) | Level 2 (snapshot) |
|---|---|---|
| `file_window` | path + 总行数 + 已读 range 范围 | path + 总行数 |
| `search_window` | query + 命中数 + 前 3 条预览 | query + 命中数 |
| `do_window` | child thread id + status + 最近一条 transcript line | child thread id + status |
| `talk_window` | peer + 总消息数 + 最近 2 条 | peer + 总消息数 |
| `program_window` | language + 已执行次数 + 最后一次 status | language + 已执行次数 |
| `knowledge_window` | title + description（frontmatter）| title |
| `command_exec` window | command path + 当前 args 摘要 | （不应被压缩 — 是活动操作）|
| `issue_window` | session 订阅状态 + 未读数 | 仅订阅锚点 |
| `root` | （永不压缩）| （永不压缩）|

### 4.2 Events 流治理

events 不属 window 系统，独立设计：

```
events = [head_ring..., <events_summary count=N earliest=T1 latest=T2 .../>, tail_ring...]
```

- **tail_ring**：最近 K 条 ProcessEvent，永远完整（默认 K=40）
- **head_ring**：最早 J 条 ProcessEvent，永远完整（默认 J=10，保任务起点）
- **中间**：超过 head + tail 容量时，**chunk-by-chunk** 摘要进 `events_summary` 节点
  - 摘要由 LLM 在 `compress` tool 调用时生成（不是后台自动 LLM 调用 — 避免引入"幽灵 LLM 流量"）
  - 也可由 LLM 自己直接产出 summary 文本（推荐：LLM 已经知道当前发生过什么，自己 fold 最准确）

写入位置：summary 作为一个**特殊 ProcessEvent** 类型 `events_summary`，与其它 event 同序保存到 thread.json，符合 OOC「所有状态都进 ProcessEvent 流」的 visibility-first 原则。

### 4.3 自然衰减规则

由 ThinkLoop 在每轮 buildContext 前跑一次 `applyNaturalDecay(thread)`：

| 规则 | 触发条件 | 动作 |
|---|---|---|
| **idle-fold** | window status ∈ {done, archived, idle} 持续 N 轮 (默认 N=3) | level 0 → 1 |
| **age-fold** | window 自上次被 LLM exec 操作起 M 轮无访问 (默认 M=10) | level 0 → 1 |
| **double-fold** | level 1 状态再次持续 K 轮 (默认 K=8) | level 1 → 2 |
| **cascade** | parent fold 时所有 child fold 同档 | 联动 |

衰减结果记一条 ProcessEvent：`{ type: "context_compressed", windowIds: [...], levelChange: "0→1", reason: "idle-fold" }`。

### 4.4 紧急兜底（emergency budget guard）

ThinkLoop 第 1 步（构建 Context 之前）：
1. 估算当前 thread 若全 level 0 渲染的 token（粗估：JSON.stringify length / 4）。
2. 若超 `budget.soft` (默认 100K)：
   - 在 system prompt 顶部插入一条 `<context_budget_warning current="120K" soft="100K" hard="180K">` 通知 LLM。
   - LLM 可选择主动 `compress`，否则继续。
3. 若超 `budget.hard` (默认 180K)：
   - 自动 level 0 → 1（所有非 active window）。
   - 再超 → 自动 level 1 → 2。
   - 全部还超 → events_summary 自动 fold（无 LLM 摘要，仅 count + 时间戳）。
   - 每一步落一条 ProcessEvent。

`budget.soft` / `budget.hard` 写在 stone 级配置（`stones/<self>/config/context-budget.json`），允许各 Object 独立调参。

### 4.5 LLM 主动入口：`compress` tool

```
compress(args: {
  scope: "windows" | "events" | "auto",
  targetIds?: string[],   // 指定 window 时
  level?: 1 | 2,
  summary?: string,       // scope=events 时由 LLM 提供摘要文本
})
```

- `compress(scope="windows", targetIds=["search:abc","file:def"], level=1)` — 主动收纳指定 window
- `compress(scope="events", summary="...")` — 主动 fold 中段 events，LLM 自写摘要
- `compress(scope="auto")` — 让系统按当前 budget 状态自动决策（即触发 §4.4 emergency 路径但提前）

配套：每个 window 通过 `compressView` 折叠后注册 `expand` 命令 → `exec(window_id, "expand")` 恢复 level 0。

---

## 5. 与 OOC 现有概念的接口

### 5.1 在 `meta/object.doc.ts` 的接入点

- `thinkable.children` 加新 child：`context_budget`
  - children: budget_levels / natural_decay / emergency_guard
  - 引用 executable.tools.compress / WindowTypeDefinition.compressView
- `thinkable.children.context` 加 patch：`compression_state`，说明 ContextWindow 多了一个 `compressLevel` 字段
- `executable.children.tools` 把 `compress` 从 todo 升级为正式 child
- `executable.children.context_window.children.render_dispatch` 加 patch：`compress_dispatch`（与 renderXml 同协议）
- `observable` 加一句：`context_compressed` 是合法 ProcessEvent type，进入 debug 落盘

### 5.2 代码层落点（仅枚举，不实施）

- `src/executable/windows/_shared/registry.ts` — `WindowTypeDefinition` 加 `compressView?` 字段
- `src/thinkable/context/render.ts` — 调度器读 `window.compressLevel`，level≥1 时调 `compressView`
- `src/thinkable/context/budget.ts` 【新】— estimateTokens + applyNaturalDecay + emergencyGuard
- `src/executable/tools/compress.ts` 【新】— 注册到 OOC_TOOLS
- `src/executable/windows/_shared/expand-command.ts` 【新】— 通用 expand command 自动挂到 level≥1 的 window
- `src/observable/process-event.ts` — 添加 `context_compressed` event type

---

## 6. 实施分阶段（建议）

| Phase | 工作量 | 落地内容 | 验收 |
|---|---|---|---|
| **P0a** | 小 | meta 层 design 落 `context_budget` 节点；接受/驳回 | Supervisor 点头 |
| **P0b** | 中 | `compressLevel` 字段 + 默认 renderXml fallback + `compress` tool 注册 | 一个 e2e：LLM 调 `compress(scope=windows)` 后 context XML 出现 folded 节点 |
| **P0c** | 中 | 4 个高频 type 实现 compressView：file / search / talk / do | 各自单测 + 一个综合 e2e |
| **P0d** | 中 | 自然衰减规则跑起来 | e2e：跑 20 轮 thinkloop 后 idle window 自动 folded |
| **P0e** | 小 | emergency guard | e2e：构造超 hard budget 输入，断言 context 自动降级 |
| **P0f** | 中 | events 流 head/tail ring + summary | e2e：50+ events thread 跑一遍 compress(scope=events) |

每个 phase 派单到 AgentOfThinkable，AgentOfExperience 验证。

---

## 7. 不变量 & 风险

### 不变量
- **可见性**：每次 compress 必落 ProcessEvent。LLM / debug / UI 永远知道何时何处压缩了。
- **可逆性**：所有 level≥1 window 必须挂 expand command。
- **type-dispatch 不破**：compress 像 renderXml 一样按 type 分发，render.ts 不出现 switch-by-case。
- **持久化**：compressLevel 字段进 thread.json；事件 fold 后原 events 留在 thread.json（不真删），仅 LLM 视图中替换为 summary。
- **不引入 ghost LLM 流量**：events_summary 由 LLM 在 compress 调用中提供，不在后台偷偷 LLM 调用。

### 风险
| 风险 | 概率 | 缓解 |
|---|---|---|
| LLM 永不主动 compress，全靠 emergency 兜底，体验差 | 中 | budget meter 进 system prompt；soft warning 后给一条 knowledge 提示策略 |
| compressView 实现质量不齐，某 type 折叠后信息丢失 | 高 | 严格单测：fold→expand→还原 后 LLM 仍能完成原任务 |
| 自然衰减把 LLM 正在用的 window 错折叠 | 中 | M 轮无访问门槛 + active 状态豁免；fold 时落 event 让 LLM 看见反应 |
| events_summary 由 LLM 自写，质量参差 | 中 | summary 节点带 `quality_hint` 字段，rough/curated 自标；之后由 reflectable 沉淀到 stone memory 的"摘要风格"知识 |
| compressLevel 持久化把 thread.json 撑大（每个 window 多一个字段）| 低 | 默认值 0 时不序列化（writeThread stripVolatile 类似处理）|

---

## 8. 与 CCB 的最终对照

| CCB 机制 | OOC 等价 | OOC 优势 |
|---|---|---|
| Session Memory 整体摘要 | events ring + events_summary | 不是"压缩对话"，而是"折叠事件流"；仍是结构化 ProcessEvent |
| API summaries 每条消息旁挂摘要 | window-typed compressView level 1 | 信息单元是 window，比 message 粒度更准 |
| MicroCompact 字段级裁剪 | compressView level 2 / 自然衰减 | 由 type owner 决定裁什么 |
| Token budget enforcement | budget.soft / budget.hard + emergency guard | 暴露给 LLM 作为可决策的状态，不是静默裁切 |
| /compact 命令 | compress tool（已留位）| LLM 视野内的 first-class action，不是会话外指令 |

---

## 9. 下一步（需 Supervisor / 人类拍板）

1. **本 design 可否接受？** 是 → 继续；否 → 哪条原则不同意。
2. **是否同步把 design 落到 `meta/object.doc.ts`？**（thinkable.context_budget + executable.tools.compress 升级）
3. **派单 AgentOfThinkable** 从 P0b 起跑 — 还是先把 design 给 AgentOfExperience 评估一轮"会不会破坏现有 e2e"？

---

## 历史

- **2026-05-25**：首版。Round 1 外循环产物。
- **2026-05-25**（P0b 实施后修订）：两处与实际落地的措辞对齐：
  1. `compress` tool args schema 用 snake_case：`target_ids` (而非 design 原写的 `targetIds`)；与 OOC 现有 tool schema (`window_id` / `reply_to_window_id`) 一致；handler 兼容 camelCase。
  2. compressView **fallback shape**（type 未注册 hook 时）：`<title>` + `<status>` + `<compressed level="1|2"/>` + `<commands hint="expand">`。比表格里的"仅 title + summary"更详细，便于 LLM 看见自身处于压缩态、调用 expand 恢复。
  3. ProcessEvent shape 实际形态：`{ category: "context_change", kind: "context_compressed", windowIds, levelChange, reason, scope? }`（design §4.4 / §4.5 描述的更扁平字段在源码里包在 category/kind 二级结构里——与现有 ProcessEvent 体例一致）。
