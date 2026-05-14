import { thinkable_v20260504_1 } from "@meta/object/thinkable/index.doc";
import * as thinkableContextSource from "../../../../src/thinkable/context.ts";
import * as thinkloopSource from "../../../../src/thinkable/thinkloop.ts";
import * as executableToolsSource from "../../../../src/executable/tools.ts";
import * as observableSource from "../../../../src/observable/index.ts";

export const thinkloop_v20260505_1 = {
  get parent() { return thinkable_v20260504_1; },
  // sources 显式引用对应源码模块，确保 meta 与实现保持真实连接。
  sources: {
    context: thinkableContextSource,
    thinkloop: thinkloopSource,
    tools: executableToolsSource,
    observable: observableSource
  },
  index: `
ThinkLoop 是 Object 的思考引擎。
每一轮：context-build -> llm -> tool-use -> 循环。

ThinkLoop 支持接收 pause 信号暂停

当前第一批只实现单轮函数 think(thread, llmClient)。

本批次的外围能力先由占位函数承接：

- buildContext
- getAvailableTools
- dispatchToolCall
- isPausing
- writeLatestLlmInput
- writeLatestLlmOutput

对应源码位置：

- src/thinkable/context.ts
- src/thinkable/thinkloop.ts
- src/executable/tools.ts
- src/observable/index.ts

## 单轮流程

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

ThinkLoop 是 **单个 thread 内的异步循环**：
Scheduler 为每个 running 线程独立地调用 Engine 跑一轮。

## Engine 单轮详细流程

\`\`\`
Engine.runThreadIteration(threadId):

1. 构建 Context
   context = await contextBuilder.build(threadId)

2. 构造 LLM 输入
   - 当前源码已经是 Responses-first input items，而不只是传统 message-only 结构
   - 第一条仍然是 system message：<context> 信息窗口
   - 后续 transcript 则可能混合 message / function_call / function_call_output

3. LLM 输入记录
     writeLatestLlmInputToFile(context) // 将 LLM 的输入存到本地，用于 debug

4. 调用 LLM
   result = await llmClient.generate({ input, tools: getAvailableTools() })

5. 记录输出事件
  5.1 assistant text / thinking / function_call 先写入 thread.events

6. 输出记录
   writeLatestLlmOutputToFile(result) // 将 LLM 的输出存到本地，用于 debug

7. 检查 pause 信号
  if pausing:
    setNodeStatus("paused")
    return  // 阻断 tool use 的执行，等人工 resume（详见 observable 文档）, 这期间用户可以编辑上述记录 LLM 输出的文件，resume 后读取文件中的内容作为新的 LLM 输出继续执行下一步骤

8. 执行 tool call
   switch toolName:
     case "open":   handleOpen(args)    // 详见 executable/actions/tools/open
     case "refine": handleRefine(args)
     case "submit": handleSubmit(args)  // 内部 executeCommand 派发到 program/talk/do/plan/...
     case "close":  handleClose(args)
     case "wait":   handleWait(args)
     case "compress": handleCompress(args)
\`\`\`

## 执行能力

LLM 始终面向 6 个 tool：open / refine / submit / close / wait / compress。
具体能"做什么"由 submit 时携带的 command 决定（program / talk / do / plan / todo / compress / end 等）。

详见 executable 文档

## 过程(Process Events)

线程过程称为 process events，作为 context 的一部分，一起记录到 thread.json。
Process Event 表达"上下文如何变化"，分为两类：

- llm_interaction：LLM 交互过程
    - text / tool_use / thinking
- context_change：上下文变化提示

前端时间线视图直接渲染 events 数组，内核与前端字段名一致。

### 当前 thinking 的真实行为

设计意图上，thinking 原本不应该进入下一轮 Context：

1. **套娃风险**：LLM 看到自己之前的 thinking，可能开始 meta-thinking（思考自己的思考），失控
2. **Context 爆炸**：thinking 通常比 content 长 2-5 倍，注入会急速耗 token
3. **价值低**：thinking 是"本轮的推理过程"——过了就过了；有价值的结论应通过 content / tool_use 显式表达

但**当前源码实现尚未完全对齐这个意图**：\`thinking\` 事件会被转换成 assistant message，继续进入下一轮 transcript。

因此这里要把“设计目标”和“当前实现”分开看：

- 设计目标：thinking 只记录、不复喂
- 当前实现：thinking 会回灌；后续若要继续收敛，应以源码改动为准

## 当前实现补充语义

- 连续两轮若 assistant text 完全相同，thinkloop 会做去重，不再追加重复 text event。
- 多个 tool call 当前按顺序串行执行，不做并发派发。
- 单个 tool 失败时，线程不会直接进入 failed；系统会写入 function_call_output(ok=false) 与错误提示 inject，然后结束本轮，把修复权交给下一轮 LLM。
- 只有更外层的严重错误（例如 buildContext / provider generate 失败）才会把线程状态设为 failed。
- thinkloop 已与 observable 的 beginLlmLoop / finishLlmLoop 对接，因此 pause / ok / error 三类结局都会进入 loop meta。

## 错误处理

### Tool Call 失败

\`\`\`
try { dispatchToolCall(...) }
catch (error):
  events.push({ type: "inject", content: error.message })
  // 不自动 fail 线程，让 LLM 决定如何处理
\`\`\`

### 严重错误（如 LLM 调用失败）

\`\`\`
try { result = await llmClient.generate(...) }
catch (error):
  events.push({ type: "inject", content: error.message })
  setNodeStatus("failed")
  // 失败时由系统向 creator 投递一条 inbox 消息告知失败原因
\`\`\`

## 与其他维度的协作

- 感知阶段：context-builder 组装 Context（详见 thinkable/context）
- 思考阶段：LLM Provider 抽象（Provider 接口由 thinkable/llm 实现）
- 行动阶段：tool calls 由 Engine handler 分派到 executable 维度
- 记录阶段：events 等数据的落盘由 storable/persistable 维度负责
- 调度阶段：Scheduler 决定下一个执行的线程（详见 thread/scheduler）
`,
};
