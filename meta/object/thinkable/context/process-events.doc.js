import { context_v20260505_1 } from "@meta/object/thinkable/context/index.doc";
import * as contextSource from "@src/thinkable/context";

/**
 * ProcessEvents 概念：线程内部稳定的过程事件流（ProcessEvent union schema）。
 *
 * sources:
 *  - context — ProcessEvent type 定义与 buildInputItems transcript 转换
 */
export const process_events_v20260514_1 = {
  name: "ProcessEvents",
  get parent() { return context_v20260505_1; },
  sources: {
    context: contextSource,
  },
  description: `
ProcessEvents 是线程内部稳定的过程事件流，服务 thinkloop / context-builder /
observable+persistable+timeline 三方共同消费同一份事件流。

按子字段展开：

- consumers — 三类消费方各自从事件流取什么
- categories — 事件三大类（llm_interaction / context_change / tool_runtime）与字段
- transcriptMapping — 各事件如何转换成下一轮 LLM input items
- layeringWithContext — 与 XML system context 的两层分工
`.trim(),

  consumers_v20260517_1: {
    index: `
## 事件流的三类消费方

- **thinkloop**：把单轮 LLM 输出与 tool 执行结果写回线程
- **context builder**：把可进入 transcript 的事件转换成下一轮 LLM input items
- **observable / persistable / web timeline**：围绕同一条事件流做回看、展示与留档

源码 \`ProcessEvent\` 定义见 \`src/thinkable/context/index.ts\`。
`.trim(),
  },

  categories_v20260517_1: {
    index: `
## 事件分类

### llm_interaction —— LLM 直接产出

- \`text\`
  - 字段：\`text\`
  - 含义：assistant 对外可见的自然语言输出
- \`tool_use\`
  - 字段：\`toolName\`、\`arguments\`
  - 含义：工具调用记录，保留 LLM 当时的原始调用意图
- \`function_call\`
  - 字段：\`callId\`、\`toolName\`、\`arguments\`
  - 含义：Responses-first 语义下的一等 tool 调用记录
- \`thinking\`
  - 字段：\`text\`
  - 含义：provider 返回的思考文本；记录，不回传给 LLM

\`toolName\` 取值范围：\`open\` / \`refine\` / \`submit\` / \`close\` / \`wait\` / \`compress\`。

### context_change —— 系统、工具或外部输入带来的上下文变化

- \`inject\`
  - 字段：\`text\`
  - 含义：系统补充给线程的提示文本
- \`inbox_message_arrived\`
  - 字段：\`msgId\`、可选 \`text\`
  - 含义：inbox 中有一条新消息到达，可与实际 inbox message 关联

### tool_runtime —— tool 调用执行后的运行时结果

- \`function_call_output\`
  - 字段：\`callId\`、\`toolName\`、\`output\`、\`ok\`
  - 含义：某次 \`function_call\` 的序列化输出
`.trim(),
  },

  transcriptMapping_v20260517_1: {
    index: `
## 进入 transcript 的转换规则

\`buildInputItems(thread)\` 先生成 XML context，再把 \`thread.events\` 逐条转换成
transcript items。

### \`inbox_message_arrived\`

转换成 system message：

\`\`\`
[context_change:inbox_message_arrived] msg_id=... from=...
\`\`\`

\`from=...\` 来自 inbox 中按 \`msgId\` 找到的真实消息来源；若事件自带 \`text\` 会附加到这条
message 后面。

### \`context_change.inject\`

错误型 inject 进入 system message：

\`\`\`
[context_change:error]
...
\`\`\`

错误型判定来自 \`isErrorInject(text)\`，命中条件包括：以 \`[错误]\` 开头 / 包含 \`失败\` /
包含 \`Error\` / 包含 \`error\`。

### \`function_call\`

转换成 Responses-first \`function_call\` input item，保留 \`call_id\` / \`name\` /
\`arguments\`。

### \`function_call_output\`

转换成 Responses-first \`function_call_output\` input item，保留 \`call_id\` /
\`name\` / \`output\`。

### \`thinking\`

转换成 assistant message：

\`\`\`
[thinking]
...
\`\`\`

### \`text\`

转换成 assistant message，内容直接使用 \`event.text\`。

### \`tool_use\`

保留在事件流中供时间线、调试与压缩策略使用；进入 transcript 的 tool 协议以
\`function_call\` / \`function_call_output\` 为主。
`.trim(),
  },

  layeringWithContext_v20260517_1: {
    index: `
## 与 Context 的分层关系

单轮 LLM 输入由两部分组成：

1. \`renderContextXml(...)\` 产出的 XML system context
2. 由 process events 转换出来的 transcript items

process events 在 Context 中承担的是"过程历史层"：

- XML 负责表达当前稳定状态
- process events 负责表达上一轮到当前轮之间发生过的交互与变化

这组分层对应 \`buildContext\` / \`buildInputItems\` 的实现。
`.trim(),
  },
};
