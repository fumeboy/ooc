import { thinkable_v20260504_1 } from "@meta/object/thinkable/index.doc";
import * as thinkableContextSource from "@src/thinkable/context";
import * as thinkloopSource from "@src/thinkable/thinkloop";
import * as executableToolsSource from "@src/executable/tools";
import * as observableSource from "@src/observable/index";

/**
 * ThinkLoop 概念：单个 thread 内的单轮思考循环（context-build → llm → tool_use → 循环）。
 *
 * sources:
 *  - context    — buildInputItems / ThreadContext，单轮 LLM 输入构造
 *  - thinkloop  — think(thread, llmClient) 单轮编排器
 *  - tools      — getAvailableTools / dispatchToolCall（tool 派发口）
 *  - observable — beginLlmLoop / finishLlmLoop / isPausing pause 信号 + loop meta
 */
export const thinkloop_v20260505_1 = {
  name: "Thinkloop",
  get parent() { return thinkable_v20260504_1; },
  sources: {
    context: thinkableContextSource,
    thinkloop: thinkloopSource,
    tools: executableToolsSource,
    observable: observableSource,
  },
  description: `
ThinkLoop 是 Object 的思考引擎，单轮顺序为 感知 → 思考 → 行动 → 记录 → 循环。

按子字段展开：

- iterationFlow — 单轮 think 的 8 步顺序与每一步对应 helper
- toolPrimitives — LLM 始终面向的 6 个 tool 原语
- processEvents — 本轮事件流的两大类与时间线视角
- thinkingBehavior — thinking 事件的设计目标与当前实现差距
- errorHandling — tool 失败与严重错误的分级处理
- collaboration — 与其他维度的协作分工
`.trim(),

  iterationFlow_v20260517_1: {
    index: `
## 单轮流程

分三个子节点：高层抽象、调度边界、Engine 单轮详细顺序。
`.trim(),

    abstract_v20260517_1: {
      index: `
### 高层抽象

\`\`\`
感知   ──  构建 Context（context-builder）
  ↓
思考   ──  LLM 基于 Context + tools 生成输出
  ↓
行动   ──  Engine 处理 tool call (open/refine/submit/close/wait)
  ↓
记录   ──  Process Event 作为 context 的一部分，一起记录到 thread.json
  ↓
循环   ──  Scheduler 驱动该线程进入下一轮（或切换状态）
\`\`\`
`.trim(),
    },

    schedulingBoundary_v20260517_1: {
      index: `
### 调度边界

ThinkLoop 是**单个 thread 内的异步循环**：Scheduler 为每个 running 线程
独立地调用 Engine 跑一轮。多线程的并行性由 Scheduler 决定，不属于 thinkloop 本身。
`.trim(),
    },

    engineSteps_v20260517_1: {
      index: `
### Engine 单轮详细顺序

\`\`\`
Engine.runThreadIteration(threadId):

1. 构建 Context
   context = await contextBuilder.build(threadId)

2. 构造 LLM 输入
   - 当前是 Responses-first input items，而不仅是 message-only 结构
   - 第一条仍然是 system message：<context> 信息窗口
   - 后续 transcript 则可能混合 message / function_call / function_call_output

3. LLM 输入记录
   writeLatestLlmInputToFile(context) // 将 LLM 的输入存到本地，用于 debug

4. 调用 LLM
   result = await llmClient.generate({ input, tools: getAvailableTools() })

5. 记录输出事件
   assistant text / thinking / function_call 写入 thread.events

6. 输出记录
   writeLatestLlmOutputToFile(result) // 将 LLM 的输出存到本地，用于 debug

7. 检查 pause 信号
   if pausing:
     setNodeStatus("paused")
     return  // 阻断 tool use 执行，等人工 resume（详见 observable）；
             // 这期间用户可以编辑上述 LLM 输出文件，resume 后读取文件内容作为新的 LLM 输出继续

8. 执行 tool call
   switch toolName:
     case "open":     handleOpen(args)     // 详见 executable/actions/tools/open
     case "refine":   handleRefine(args)
     case "submit":   handleSubmit(args)   // 内部 executeCommand 派发到 program/talk/do/plan/...
     case "close":    handleClose(args)
     case "wait":     handleWait(args)
     case "compress": handleCompress(args)
\`\`\`
`.trim(),
    },
  },

  toolPrimitives_v20260517_1: {
    index: `
## 执行能力（6 个 tool）

LLM 始终面向 6 个 tool：\`open / refine / submit / close / wait / compress\`。
具体能"做什么"由 submit 时携带的 command 决定（\`program / talk / do / plan / todo /
compress / end\` 等）。详见 executable 文档。
`.trim(),
  },

  processEvents_v20260517_1: {
    index: `
## 过程 (Process Events)

线程过程称为 process events，作为 context 的一部分，一起记录到 thread.json。
Process Event 表达"上下文如何变化"，分为两类：

- \`llm_interaction\`：LLM 交互过程（\`text\` / \`tool_use\` / \`function_call\` /
  \`thinking\` / \`function_call_output\`）
- \`context_change\`：上下文变化提示（\`inject\` / \`inbox_message_arrived\`）

前端时间线视图直接渲染 events 数组，内核与前端字段名一致。详见
thinkable/context/process-events 概念。
`.trim(),
  },

  thinkingBehavior_v20260517_1: {
    index: `
## thinking 的设计目标与实现差距

分两个子节点：设计意图（不进 Context 的三条理由）与现状映射。
`.trim(),

    designIntent_v20260517_1: {
      index: `
### 设计意图

设计意图上，thinking 不应进入下一轮 Context：

1. **套娃风险**：LLM 看到自己之前的 thinking，可能开始 meta-thinking
   （思考自己的思考），失控
2. **Context 爆炸**：thinking 通常比 content 长 2-5 倍，注入会急速耗 token
3. **价值低**：thinking 是"本轮的推理过程"——过了就过了；有价值的结论
   应通过 content / tool_use 显式表达
`.trim(),
    },

    currentMapping_v20260517_1: {
      index: `
### 现状映射

\`thinking\` 事件在 transcript 转换中被映射成 assistant message 进入下一轮
transcript（详见 \`thinkable.context.processEvents.transcriptMapping.thinkingMapping\`）。
`.trim(),
    },
  },

  errorHandling_v20260517_1: {
    index: `
## 错误处理（分级）

分三个子节点：Tool Call 失败、严重错误、实现补充语义。
`.trim(),

    toolCallFailure_v20260517_1: {
      index: `
### Tool Call 失败

\`\`\`
try { dispatchToolCall(...) }
catch (error):
  events.push({ type: "inject", content: error.message })
  // 不自动 fail 线程；写入 function_call_output(ok=false) 与错误提示 inject，
  // 然后结束本轮，把修复权交给下一轮 LLM
\`\`\`
`.trim(),
    },

    severeFailure_v20260517_1: {
      index: `
### 严重错误（如 LLM 调用失败 / buildContext 失败）

\`\`\`
try { result = await llmClient.generate(...) }
catch (error):
  events.push({ type: "inject", content: error.message })
  setNodeStatus("failed")
  // 失败时由系统向 creator 投递一条 inbox 消息告知失败原因
\`\`\`
`.trim(),
    },

    implementationNotes_v20260517_1: {
      index: `
### 实现补充语义

- 连续两轮若 assistant text 完全相同，thinkloop 做去重，不再追加重复 text event
- 多个 tool call 按顺序串行执行，不做并发派发
- thinkloop 与 observable 的 \`beginLlmLoop\` / \`finishLlmLoop\` 对接；
  pause / ok / error 三类结局都会进入 loop meta
`.trim(),
    },
  },

  collaboration_v20260517_1: {
    index: `
## 与其他维度的协作

按 ThinkLoop 单轮 5 个阶段分别落到其它维度。详见子节点。
`.trim(),

    perceive_v20260517_1: {
      index: `
### 感知阶段

context-builder 组装 Context（详见 thinkable/context）。
`.trim(),
    },

    think_v20260517_1: {
      index: `
### 思考阶段

LLM Provider 抽象（Provider 接口由 thinkable/llm 实现）。
`.trim(),
    },

    act_v20260517_1: {
      index: `
### 行动阶段

tool calls 由 Engine handler 分派到 executable 维度。
`.trim(),
    },

    record_v20260517_1: {
      index: `
### 记录阶段

events 等数据的落盘由 storable / persistable 维度负责。
`.trim(),
    },

    schedule_v20260517_1: {
      index: `
### 调度阶段

Scheduler 决定下一个执行的线程（详见 thread/scheduler）。
`.trim(),
    },
  },
};
