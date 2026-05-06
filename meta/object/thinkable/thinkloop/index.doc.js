import { thinkable_v20260504_1 } from "@meta/object/thinkable/index.doc";

export const thinkloop_v20260505_1 = {
    parent: thinkable_v20260504_1,
    index: `
ThinkLoop 是 Object 的思考引擎。
每一轮：感知 → 思考 → 行动 → 记录 → 循环。

## 单轮流程

\`\`\`
感知   ──  构建 Context（context-builder）
  ↓
思考   ──  LLM 基于 Context + tools 生成输出
  ↓
行动   ──  Engine 处理 tool call (open/refine/submit/close/wait)
  ↓
记录   ──  Process Event 写入 thread.json.events
  ↓
循环   ──  Scheduler 驱动该线程进入下一轮（或切换状态）
\`\`\`

ThinkLoop 不是一个全局循环，而是 **per-thread 的异步循环**：
Scheduler 为每个 running 线程独立地调用 Engine 跑一轮。

## Engine 单轮详细流程

\`\`\`
Engine.runThreadIteration(threadId):

1. 构建 Context
   context = await contextBuilder.build(threadId)

2. 检查 pause 信号
   if pausing:
     writeLatestLlmInput(context)
     setNodeStatus("paused")
     return  // 等人工 resume（详见 observable/pause）

3. 构造 LLM Messages
   - system message：<context> 信息窗口（whoAmI / knowledge / task / inbox / activeForms / ...）
   - process event messages：当前线程的历史变化（LLM 交互 + 上下文变化）

4. 调用 LLM
   result = await llmClient.chat(messages, { tools: getAvailableTools() })

5. 处理 thinking 输出
   if result.thinkingContent:
     events.push({ type: "thinking", content: result.thinkingContent })
     SSE.emit("stream:thought", ...)

6. 处理正文输出
   if result.content && content !== thinkingContent:
     events.push({ type: "text", content: result.content })

7. 解析 tool calls
   toolCalls = result.toolCalls ?? parseTextualToolCall(result.content)
   // 始终启用文本兜底：toolCalls 缺失时用文本解析还原

8. 处理 mark 参数（任意 tool 都可携带 args.mark）
   for each m in args.mark:
     tree.markInbox(threadId, m.messageId, m.type, m.tip)
     // m.type ∈ "ack" | "ignore" | "todo"

9. 分派 tool call（取 toolCalls[0]，单轮一调用）
   switch toolName:
     case "open":   handleOpen(args)    // 详见 executable/actions/tools/open
     case "refine": handleRefine(args)
     case "submit": handleSubmit(args)  // 内部 executeCommand 派发到 program/talk/do/plan/...
     case "close":  handleClose(args)
     case "wait":   handleWait(args)

10. 持久化 + 状态推进
    tree.writeThreadData(threadId, td)
    // setNodeStatus 由各 handler 或 command 内部推进
\`\`\`

## 五原语 + 派生 command

LLM 始终面向 5 个 tool：open / refine / submit / close / wait。
具体能"做什么"由 submit 时携带的 command 决定（program / talk / do / plan / defer / compress 等）。
注意：完成线程不需要专门的 return command——子线程通过 talk(target=creator, ...) 把结果送回。

详见 executable/actions/tools 与 executable/actions/commands。

## Process Events

线程历史称为 process events，落盘在 thread.json.events。
表达"上下文如何变化"，分两类进入 LLM messages：

- llm_interaction：LLM 交互过程
    - message_in / message_out / text / tool_use / thinking
- context_change：上下文变化提示
    - inject / program / plan / create_thread / mark_inbox / compress_summary

前端时间线视图直接渲染 events 数组，内核与前端字段名一致。

## 两条 LLM 输出解析路径

### 主路径：Tool Calling

LLM 返回结构化 toolCalls 时走此路径。强类型，每个 tool 有明确 JSON schema。

### 兼容路径：文本兜底

某些 Provider 不返回结构化 toolCalls，而是把工具调用嵌在正文文本里。
Engine 始终调用 parseTextualToolCall 兜底：识别形如 \`tool_name({...JSON...})\` 的片段，
还原为 ToolCall 后再交给同一套 handler。

随主流模型升级，兜底命中率持续递减，但路径保留。

## Thinking Mode — 双通道架构

OOC 把 LLM 的 thinking 输出与 action 输出分开处理。

### 历史背景

早期 OOC 让 LLM 用文本协议输出思考：

\`\`\`
<thinking>用户问 X，我应该先查 Y...</thinking>
<tool_call>open(...)</tool_call>
\`\`\`

Engine 需写 parser 拆分两段。问题：
- LLM 偶尔忘闭合标签，容易出错
- 需用 prompt 不断强调格式
- 占用模型的输出带宽

### 当前：Provider 能力层

现代 LLM 原生支持 thinking。Provider 返回的 LLMResult：

\`\`\`typescript
interface LLMResult {
  content: string;              // 对话正文（给用户的话）
  thinkingContent: string;      // LLM 的思考过程
  toolCalls: ToolCall[];        // 结构化 tool 调用
  usage: TokenUsage;
}
\`\`\`

thinking 与 content 通过**不同字段**返回，天然分开，不需要 parser。

### 双通道分工

\`\`\`
Provider 能力层
  - 开启 thinking
  - 读取 thinking 输出
  - 适配为 LLMResult 统一结构
        ↓
Engine 语义映射层
  - thinkingContent → thinking event（落库 thread.json）
  - content → text event
  - toolCalls → tool_use event
        ↓
SSE 推送层
  - stream:thought / stream:thought:end
  - stream:action / stream:action:end
  - stream:program / stream:program:end
\`\`\`

### thinking event 不进入下一轮 Context

为什么不让 LLM 看到自己上一轮的 thinking？

1. **套娃风险**：LLM 看到自己之前的 thinking，可能开始 meta-thinking（思考自己的思考），失控
2. **Context 爆炸**：thinking 通常比 content 长 2-5 倍，注入会急速耗 token
3. **价值低**：thinking 是"本轮的推理过程"——过了就过了；有价值的结论应通过 content / tool_use 显式表达

所以 thinking event 只是**记录**（写入 thread.json 供回看），**不**进入下一轮 Context。

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
try { result = await llmClient.chat(...) }
catch (error):
  events.push({ type: "inject", content: error.message })
  setNodeStatus("failed")
  // 失败时由系统向 creator 投递一条 inbox 消息告知失败原因
\`\`\`

## 与其他维度的协作

- 感知阶段：context-builder 读取本线程的 events / inbox / scopeChain，组装 Context（详见 thinkable/context）
- 思考阶段：LLM Provider 抽象（Provider 接口由 thinkable/llm 实现）
- 行动阶段：tool calls 由 Engine handler 分派到 executable 维度
- 记录阶段：events 落盘由 storable/persistable 维度负责
- 调度阶段：Scheduler 决定下一个执行的线程（详见 thread/scheduler）
`,
};
