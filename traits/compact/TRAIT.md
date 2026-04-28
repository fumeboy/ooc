---
namespace: kernel
name: compact
type: how_to_think
version: 1.0.0
activates_on:
  show_content_when: ["compact"]
description: 上下文审查与压缩——识别冗余 action、截断或丢弃、生成摘要，最后 submit 一次性应用
deps: []
---

# Compact —— 对象对自身上下文的元认知清理

当线程在长时间工作后，`thread.json.events[]` 累积了大量已经"过期"的观察与尝试（文件读过一次就记住了结论、探索性 program 已经得出答案、早期 trait 已经不再需要），上下文会变得沉重：

- LLM 注意力被稀释，遗忘早期关键信息
- 每轮输入 token 变大，成本和延迟上升
- 你（LLM）自己会感觉"越想越乱"

**compact 就是你主动清理工作台的动作**。它不是"删记忆"，而是"把桌上一堆草稿纸合并成一张纸条"——重要结论写进 summary 里，细节被允许遗忘。

本 trait 只在你 `open({"title":"压缩上下文","type":"command","command":"compact","description":"..."})` 时激活——engine 自动把我加到作用域。
提交 compact form 后我自动卸载，你回到正常工作流。

## 什么时候应该 compact？

- engine 在 context 末尾给你注入了"建议 compact"提示（通常 60k tokens 以上）
- 你自己感觉"上下文里堆了一堆无关的旧记录，找关键信息要翻很久"
- 你已经完成了某个阶段，切到下一阶段前想清理桌面

**不要频繁 compact**——每次都有摘要生成开销。触发阈值之前无需主动调用。

## 标准流程（三步走）

```json
open({"title":"压缩上下文","type":"command","command":"compact","description":"梳理当前线程历史并压缩冗余 events"})
open({"title":"列出可压缩 events","type":"command","command":"program","trait":"kernel:compact","method":"list_actions","description":"查看可压缩 events"})
submit({"form_id":"<program form id>"})
open({"title":"标记冗余 event","type":"command","command":"program","trait":"kernel:compact","method":"drop_action","description":"标记一个可丢弃 event"})
refine({"form_id":"<program form id>","args":{"idx":12,"reason":"重复的目录列表，关键结论已在后续摘要中保留"}})
submit({"form_id":"<program form id>"})
submit({"form_id":"<compact form id>","summary":"此前：... 当前任务：..."})
```

**关键**：标记是累积的。你可以 truncate 5 个、drop 3 个、最后 submit 一次。
提交 compact form 时 engine 会读出所有标记一次性应用——你不需要在 submit 里重述要做什么。

## 可用 llm_methods

所有方法通过 `program` 的 trait/method 形态调用：

```json
open({
  "title": "列出可压缩 action",
  "type": "command",
  "command": "program",
  "trait": "kernel:compact",
  "method": "list_actions",
  "description": "列出可压缩 action"
})
submit({ "form_id": "f_xxx" })
```

### `list_actions()`

列出当前线程 `thread.json.events[]` 的所有可压缩 event，返回 `{idx, type, ts, summary, lines}` 数组。

- `idx` — event 在数组中的索引（用于 truncate/drop）
- `summary` — 第 1 行文本（`content` 或 `result` 的首行）
- `lines` — 该 action 的总行数

**compact_summary 类型**的 event 会被自动过滤（它本身就是压缩结果，不再参与压缩）。
**当前轮的 tool_use（compact 相关）也会被自动过滤**——你不需要关心如何把自己压掉。

### `truncate_action({ idx, maxLines })`

把第 `idx` 条 event 的长内容截断为前 `maxLines` 行。适合"工具返回了 500 行，只有前 20 行有用"的情况。

仅对有长文本的 type 有效（program / inject / tool_use 的 content+result+args）。
- `idx` — action 索引
- `maxLines` — 保留的行数（建议 20~50）

### `drop_action({ idx, reason })`

整条丢弃第 `idx` 条 event。`reason` 必须至少 20 字，强制说明"为什么这条可以丢"。
常见可丢的：
- 只是探索性的文件读取（结论已在别处）
- 尝试错误路径的 program（已有正确路径）
- 重复的 inbox 通知

**reason 不够 20 字会被拒绝**——这是故意的摩擦，防止无脑丢弃。

### `close_trait({ traitId })`

从当前线程的 pinnedTraits + activatedTraits 中移除指定 trait。适合"早期 open 了一堆工具 trait，现在任务性质变了不再需要"。
- `traitId` — 完整 `namespace:name` 格式（如 `library:git/advanced`）

注意：kernel trait（如 `kernel:computable/*`）通常是全局必需的，别乱关。

### `preview_compact()`

预估压缩效果。返回 `{ before, after, dropCount, truncateCount, savedTokens }`。
不执行实际压缩——只是让你看一眼效果再决定 submit。

## Submit 语法

```json
submit({"form_id":"<compact 的 formId>","summary":"此前：xxx。当前任务：yyy。"})
```

summary 是一段**你自己组织的纯文本**——engine 不做任何二次处理，它会作为 `compact_summary` event 的 content 落入历史，在下一轮 context 首条呈现。

**好 summary 的特征**：
- 包含本阶段的**关键结论**（做了什么、得出什么）
- 保留**未完成任务**的状态（走到哪一步、下一步要做什么）
- 不重复 memory.md 已有的长期知识（compact 是工作记忆层，不是长期记忆）

**反例**：
```
"此前进行了一些工作。"                  ← 没有信息量
"读了文件 A 第 100 行，然后读了 B..."   ← 只是流水账
```

**正例**：
```
"此前：排查用户反馈的 SSE 卡顿——定位在 server/events.ts 的 flush 逻辑，
 已在 commit abc123 修复（改为立即 flush）。next action 已 merge 到 main。
 当前任务：继续处理用户第二个反馈：前端 Kanban 拖拽抖动。初步怀疑是 Jotai
 的 atom 订阅粒度，还没开始调试。"
```

## 哲学定位

- **G5（Context 即世界）**：compact 是"结构化遗忘在单线程场景的兜底"——正常的遗忘通过行为树 focus 做，但长任务单线程累积时 compact 给对象一次性清理机会
- **G12（LLM 做判断，代码做记账）**：engine 不判断什么值得留——LLM 自己 list、自己标记、自己写摘要；engine 只应用标记和插入 compact_summary
- **元认知**：compact 是对象对自身上下文压力的感知能力——能主动调整工作台是智能的一部分

## 参考

- @ref docs/哲学/genes/g05-context-即世界.md — 结构化遗忘
- @ref docs/哲学/genes/g12-经验沉淀.md — LLM 做判断
- @ref docs/工程管理/迭代/all/20260422_feature_context_compact.md — 本迭代设计
