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
ProcessEvents 是线程内部稳定的过程事件流，被 thinkloop / context builder /
observable+persistable+timeline 三方共同消费。

按子字段展开：

- consumers — 三类消费方及各自从事件流取什么（含 thinkloop / contextBuilder /
  observerStack 三个独立子节点）
- categories — 事件 3 大类，含每个具体事件类型的独立子节点：
  llm_interaction → text / tool_use / function_call / thinking
  context_change → inject / inbox_message_arrived
  tool_runtime → function_call_output
- transcriptMapping — buildInputItems 把事件转换成 transcript items 的逐类规则
  （每个 event kind 一个独立子节点）
- layeringWithContext — 与 XML system context 的两层分工（含两个独立子节点：
  xmlSystemPrompt 与 transcriptHistory）
`.trim(),

  consumers_v20260517_1: {
    index: `
事件流的三类消费方总览（详见各子字段）：

- thinkloop — 单轮 LLM 输出 + tool 执行结果写回线程的入口
- contextBuilder — 把可进入 transcript 的事件转换成下一轮 LLM input items
- observerStack — observable / persistable / web timeline，对事件流的回看 / 展示 / 留档

源码 \`ProcessEvent\` union 定义见 \`@src/thinkable/context\` 入口的 type re-export。
`.trim(),

    thinkloop_v20260517_1: {
      index: `
### thinkloop

单轮 LLM 调用结束时，thinkloop 把 LLM 输出（text / function_call /
thinking）与每个 function_call 的执行结果（function_call_output）依次 push 到
\`thread.events\`。读侧不直接消费——它只是写入方。
`.trim(),
    },

    contextBuilder_v20260517_1: {
      index: `
### contextBuilder

\`buildInputItems(thread)\` 在每轮调 LLM 前遍历 \`thread.events\`，按 §transcriptMapping
的转换规则产出下一轮的 transcript items（system / user / assistant messages +
function_call / function_call_output 一等 items）。
`.trim(),
    },

    observerStack_v20260517_1: {
      index: `
### observerStack (observable / persistable / web timeline)

同一份事件流被三方异步消费：

- observable：debug 模式下把 events 与 inputItems 一起落盘到 \`llm.input.json\` /
  \`loop_NNNN.*\`
- persistable：thread.json 持久化时事件流是 thread state 的核心字段之一
- web timeline：前端 ContextSnapshotViewer 把事件按时间顺序展示给开发者
`.trim(),
    },
  },

  categories_v20260517_1: {
    index: `
事件按来源分 3 大类，每类下若干 kind。每个 kind 是 ProcessEvent union 的一个
narrow 分支，下面各子节点详述其字段语义与典型出现时机。
`.trim(),

    llmInteraction_v20260517_1: {
      index: `
### llm_interaction —— LLM 直接产出

由 thinkloop 在 LLM 响应结束后写入；4 个 kind 见各子节点。
\`toolName\` 取值范围统一为：\`open\` / \`refine\` / \`submit\` / \`close\` / \`wait\` / \`compress\`。
`.trim(),

      text_v20260517_1: {
        index: `
#### text

- 字段：\`text: string\`
- 含义：assistant 对外可见的自然语言输出
- 写入：thinkloop 收到 LLM 返回的纯文本时
`.trim(),
      },

      toolUse_v20260517_1: {
        index: `
#### tool_use

- 字段：\`toolName\` / \`arguments\`
- 含义：工具调用记录，保留 LLM 当时的原始调用意图
- 用途：与 \`function_call\` 互补——tool_use 用于事件流 / debug 时间线的回看，
  function_call 用于 transcript 回喂
`.trim(),
      },

      functionCall_v20260517_1: {
        index: `
#### function_call

- 字段：\`callId: string\` / \`toolName\` / \`arguments: Record<string, unknown>\`
- 含义：Responses-first 语义下的一等 tool 调用记录
- 用途：transcript items 直接复用，让 LLM 看到自己上一轮的 tool 调用历史；与
  对应 \`function_call_output\` 通过 \`callId\` 关联
`.trim(),
      },

      thinking_v20260517_1: {
        index: `
#### thinking

- 字段：\`text: string\`
- 含义：provider 返回的思考文本（Claude / Anthropic-compatible models 的 reasoning block）
- 写入：thinkloop 检测到响应含 thinking block 时记录
- 注：仅用于回看 / debug；进入 transcript 时**不**作为推理上下文复喂
`.trim(),
      },
    },

    contextChange_v20260517_1: {
      index: `
### context_change —— 系统、工具或外部输入带来的上下文变化

由 control plane / scheduler / executable tool 等非 LLM 路径写入。2 个 kind 见子节点。
`.trim(),

      inject_v20260517_1: {
        index: `
#### inject

- 字段：\`text: string\`
- 含义：系统补充给线程的提示文本（错误 / 状态变化 / 人工补充）
- 写入侧：tool handler 校验失败 / scheduler 检测异常 / manual debug 注入
- transcript 命运：仅"错误型 inject"进入 transcript；普通 inject 视作过期上下文丢弃
  （判定见 \`transcriptMapping.injectMapping.errorClassification\`）
`.trim(),
      },

      inboxMessageArrived_v20260517_1: {
        index: `
#### inbox_message_arrived

- 字段：\`msgId: string\` / 可选 \`text: string\`
- 含义：inbox 中有一条新消息到达，可与 \`thread.inbox\` 中对应 \`msgId\` 的实体 message 关联
- 写入侧：talk-delivery 派送消息 / scheduler.emitChildEndNotifications / control plane
  user reply 路径
`.trim(),
      },
    },

    toolRuntime_v20260517_1: {
      index: `
### tool_runtime —— tool 调用执行后的运行时结果

由 dispatchToolCall 在每次 tool handler 返回后写入；当前仅 1 个 kind。
`.trim(),

      functionCallOutput_v20260517_1: {
        index: `
#### function_call_output

- 字段：\`callId\` / \`toolName\` / \`output: string\` / \`ok: boolean\`
- 含义：某次 \`function_call\` 的序列化输出
- 关联：通过 \`callId\` 与对应 \`function_call\` 配对
- transcript 命运：作为一等 \`function_call_output\` input item 进入下一轮 LLM 输入
`.trim(),
      },
    },
  },

  transcriptMapping_v20260517_1: {
    index: `
\`buildInputItems(thread)\` 先生成 XML system context，再把 \`thread.events\` 逐条
转换成 transcript items。每个 event kind 的精确映射规则见独立子节点。
`.trim(),

    inboxMessageArrivedMapping_v20260517_1: {
      index: `
### inbox_message_arrived → system message

\`\`\`
[context_change:inbox_message_arrived] msg_id=<id> from=<fromThreadId>
<可选附加 text>
\`\`\`

\`from=...\` 来自 \`thread.inbox\` 中按 \`msgId\` 找到的真实消息 \`fromThreadId\`。
事件自带 \`text\` 时附加到这条 message 后面。

provider 适配层（如 Claude）会识别该前缀，把真实正文抽出来作 user 文本块。
`.trim(),
    },

    injectMapping_v20260517_1: {
      index: `
### context_change.inject → 仅错误型进入 transcript

\`\`\`
[context_change:error]
<text>
\`\`\`

普通 inject 不进入 transcript（视作"过期上下文"）。错误型判定走
\`isErrorInject(text)\` 启发式：

- 以 \`[错误]\` 开头
- 包含 \`失败\`
- 包含 \`Error\`
- 包含 \`error\`

启发式命中的 inject 进入 transcript（保留报错信息让 LLM 在下一轮看见自己上一轮
踩的坑）；未命中的 inject 仅留在事件流供 observer 回看。
`.trim(),

      errorClassification_v20260517_1: {
        index: `
#### errorClassification

\`isErrorInject(text)\` 的 4 条命中规则（前缀 / 含中文"失败" / 含 \`Error\` / 含 \`error\`）。
任一命中视作 error inject，进入 transcript 作为 system message。
`.trim(),
      },
    },

    functionCallMapping_v20260517_1: {
      index: `
### function_call → function_call input item

转换成 Responses-first \`function_call\` input item，保留 \`call_id\` / \`name\` /
\`arguments\`。

OpenAI Responses API 直接吃这种 item；Claude 由 transport 层翻成
\`{type: "tool_use", id, name, input}\` content block（详见 \`thinkable.llm.toolUseEncoding\`）。
`.trim(),
    },

    functionCallOutputMapping_v20260517_1: {
      index: `
### function_call_output → function_call_output input item

转换成 Responses-first \`function_call_output\` input item，保留 \`call_id\` /
\`name\` / \`output\`。

Claude transport 翻成 \`{type: "tool_result", tool_use_id, content}\` content block。
`.trim(),
    },

    thinkingMapping_v20260517_1: {
      index: `
### thinking → assistant message

\`\`\`
[thinking]
<text>
\`\`\`

仅用于 transcript 完整性 / debug 回看；LLM 看到自己上一轮的思考但不作为推理上下文重新参与。
`.trim(),
    },

    textMapping_v20260517_1: {
      index: `
### text → assistant message

内容直接使用 \`event.text\`，role=assistant。
`.trim(),
    },

    toolUseMapping_v20260517_1: {
      index: `
### tool_use → 不进入 transcript

\`tool_use\` 事件保留在 \`thread.events\` 供时间线 / 调试 / 压缩策略使用；
transcript 中的 tool 协议以 \`function_call\` / \`function_call_output\` 为主，
不复用 tool_use。
`.trim(),
    },
  },

  layeringWithContext_v20260517_1: {
    index: `
单轮 LLM 输入由两部分组成，对应 \`buildContext\` / \`buildInputItems\` 实现。详见
两个独立子节点。
`.trim(),

    xmlSystemPrompt_v20260517_1: {
      index: `
### XML system context（稳定状态层）

\`renderContextXml(...)\` 把所有结构化字段（contextWindows / inbox / outbox /
status / ...）按 XML 子标签序列渲染成 system message。

职责：表达"我现在拥有什么"——当前所有 window、当前 inbox / outbox、当前激活的
knowledge 等。

体积控制：XML 转义、CDATA 包装、comment 清洗与体积截断（knowledge 8KB、
file 32KB）由 render 层负责。
`.trim(),
    },

    transcriptHistory_v20260517_1: {
      index: `
### transcript history（过程历史层）

由 process events 转换出来的 transcript items（user / assistant / tool 三种 role
+ function_call / function_call_output 一等 items）。

职责：表达"上一轮到当前轮之间发生过什么"——LLM 看到自己上轮的 tool 调用、
function 结果、回信等历史。

两层互不混用：稳定信息走 system，历史交互走 messages。这条边界让 system 在长跑
线程里仍保持可控大小，并让 LLM 不在 transcript 中复述自己已经在 system 里看到
的状态。
`.trim(),
    },
  },
};
