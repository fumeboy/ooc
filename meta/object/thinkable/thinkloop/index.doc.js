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
`,

  iterationFlow_v20260517_1: {
    title: "单轮流程",
    content: `
分三个子节点：高层抽象、调度边界、Engine 单轮详细顺序。
    `,

    abstract_v20260517_1: {
      title: "高层抽象",
      content: `
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
      `,
    },

    schedulingBoundary_v20260517_1: {
      title: "调度边界",
      content: `
ThinkLoop 是**单个 thread 内的异步循环**：Scheduler 为每个 running 线程
独立地调用 Engine 跑一轮。
      `,
    },

    multithreadingNotInScope_v20260517_1: {
      title: "不变量：多线程并行性不属于 thinkloop",
      content: `
多线程的并行性由 Scheduler 决定，不属于 thinkloop 本身。
thinkloop 看到的只有"当前 thread 的下一轮"——不感知兄弟线程是否在运行。

设计原因：让 thinkloop 实现保持单线程视角，多线程编排集中在 Scheduler 一处。
      `,
    },

    engineSteps_v20260517_1: {
      title: "Engine 单轮详细顺序",
      content: `
按子节点展开 8 步。
      `,

      step1BuildContext_v20260517_1: {
        title: "Step 1: 构建 Context",
        content: `
\`context = await contextBuilder.build(threadId)\` —— 详见 thinkable.context 概念。
        `,
      },

      step2BuildLlmInput_v20260517_1: {
        title: "Step 2: 构造 LLM 输入",
        content: `
当前是 Responses-first input items，而不仅是 message-only 结构：

- 第一条仍然是 system message：\`<context>\` 信息窗口
- 后续 transcript 则可能混合 message / function_call / function_call_output

详见 thinkable.context.llmInput。
        `,
      },

      step3WriteInputDebugFile_v20260517_1: {
        title: "Step 3: LLM 输入落盘（debug）",
        content: `
\`writeLatestLlmInputToFile(context)\` —— 将 LLM 的输入存到本地，用于 debug。
作用：人工 inspect / pause 期间可基于该文件编辑后让 resume 走"用户改写过的输入"。
        `,
      },

      step4CallLlm_v20260517_1: {
        title: "Step 4: 调用 LLM",
        content: `
\`result = await llmClient.generate({ input, tools: getAvailableTools() })\`
        `,
      },

      step5RecordOutputEvents_v20260517_1: {
        title: "Step 5: 记录输出事件",
        content: `
assistant text / thinking / function_call 写入 thread.events。
        `,
      },

      step6WriteOutputDebugFile_v20260517_1: {
        title: "Step 6: LLM 输出落盘（debug）",
        content: `
\`writeLatestLlmOutputToFile(result)\` —— 将 LLM 的输出存到本地，用于 debug。
        `,
      },

      step7CheckPauseSignal_v20260517_1: {
        title: "Step 7: 检查 pause 信号",
        content: `
\`\`\`
if pausing:
  setNodeStatus("paused")
  return
\`\`\`

阻断 tool use 执行，等人工 resume（详见 observable）。
        `,
      },

      pauseEditableOutputFile_v20260517_1: {
        title: "不变量：pause 期间 LLM 输出文件可编辑",
        content: `
pause 期间用户可以编辑 step 6 落盘的 LLM 输出文件；resume 后 thinkloop 读取**文件
内容**作为新的 LLM 输出继续（不重新调 LLM）。

让人工干预可以重写模型本轮决策（如改 tool args、删 thinking 等），是 debug /
steering 的关键能力。
        `,
      },

      step8DispatchToolCall_v20260517_1: {
        title: "Step 8: 执行 tool call",
        content: `
\`\`\`
switch toolName:
  case "open":     handleOpen(args)
  case "refine":   handleRefine(args)
  case "submit":   handleSubmit(args)   // 内部 executeCommand 派发到 program/talk/do/plan/...
  case "close":    handleClose(args)
  case "wait":     handleWait(args)
  case "compress": handleCompress(args)
\`\`\`

各 handler 详见 executable 文档。
        `,
      },
    },
  },

  toolPrimitives_v20260517_1: {
    title: "执行能力（6 个 tool）",
    content: `
LLM 始终面向 6 个 tool：open / refine / submit / close / wait / compress。详见子节点。
    `,

    fixedToolSet_v20260517_1: {
      title: "不变量：tool 集合恒定",
      content: `
LLM 始终面向**这 6 个**，不会因任务类型 / 上下文动态扩展或裁剪。

设计原因：模型对工具熟悉度跨线程一致；新能力通过"扩展 command"而非"扩展 tool"加入，
让 tool 这一层成为稳定接口。
      `,
    },

    capabilityViaCommand_v20260517_1: {
      title: "能力来自 submit 携带的 command",
      content: `
具体能"做什么"由 submit 时携带的 command 决定（program / talk / do / plan / todo /
compress / end 等）。详见 executable 文档。
      `,
    },
  },

  processEvents_v20260517_1: {
    title: "过程 (Process Events)",
    content: `
线程过程称为 process events，作为 context 的一部分，一起记录到 thread.json。
Process Event 表达"上下文如何变化"，分为两类（详见 thinkable.context.processEvents 概念）。
    `,

    eventCategories_v20260517_1: {
      title: "两类事件",
      content: `
- llm_interaction：LLM 交互过程（text / tool_use / function_call /
  thinking / function_call_output）
- context_change：上下文变化提示（inject / inbox_message_arrived）
      `,
    },

    timelineFieldParity_v20260517_1: {
      title: "不变量：前端时间线字段与内核一致",
      content: `
前端时间线视图直接渲染 events 数组，**内核与前端字段名一致**。

避免双方 schema 漂移：内核改 event 字段名等于改 UI 输入，必须同时更新前端
renderer。详见 thinkable/context/process-events 概念。
      `,
    },
  },

  thinkingBehavior_v20260517_1: {
    title: "thinking 的设计目标与实现差距",
    content: `
分三个子节点：套娃风险、Context 爆炸、价值低 + 现状映射。
    `,

    designIntent_v20260517_1: {
      title: "设计意图",
      content: `
设计意图上，thinking 不应进入下一轮 Context。三条理由各自独立子节点。
      `,

      riskMetaThinking_v20260517_1: {
        title: "套娃风险",
        content: `
LLM 看到自己之前的 thinking，可能开始 meta-thinking（思考自己的思考），失控。
        `,
      },

      riskContextExplosion_v20260517_1: {
        title: "Context 爆炸",
        content: `
thinking 通常比 content 长 2-5 倍，注入会急速耗 token。
        `,
      },

      riskLowValue_v20260517_1: {
        title: "价值低",
        content: `
thinking 是"本轮的推理过程"——过了就过了；有价值的结论应通过 content / tool_use
显式表达。
        `,
      },
    },

    currentMapping_v20260517_1: {
      title: "现状映射",
      content: `
thinking 事件在 transcript 转换中被映射成 assistant message 进入下一轮 transcript
（详见 thinkable.context.processEvents.transcriptMapping.thinkingMapping）。

即：当前实现与设计意图存在差距——保留了"完整性 / debug 回看"的折中，未做严格屏蔽。
      `,
    },
  },

  errorHandling_v20260517_1: {
    title: "错误处理（分级）",
    content: `
分子节点：Tool Call 失败、严重错误、连续 text 去重、tool call 串行执行、observable
loop meta 对接。
    `,

    toolCallFailure_v20260517_1: {
      title: "Tool Call 失败",
      content: `
\`\`\`
try { dispatchToolCall(...) }
catch (error):
  events.push({ type: "inject", content: error.message })
\`\`\`
      `,
    },

    toolCallFailureNotFatal_v20260517_1: {
      title: "不变量：Tool Call 失败不终止线程",
      content: `
tool 异常**不**自动 fail 线程；写入 function_call_output(ok=false) 与错误提示 inject，
然后结束本轮，把修复权交给下一轮 LLM。

设计原因：tool 错误大多是 args 偏差 / 资源临时不可用，让 LLM 自己看错误重试比直接挂掉
更接近"人类排错"的体验。
      `,
    },

    severeFailure_v20260517_1: {
      title: "严重错误（LLM 调用失败 / buildContext 失败）",
      content: `
\`\`\`
try { result = await llmClient.generate(...) }
catch (error):
  events.push({ type: "inject", content: error.message })
  setNodeStatus("failed")
\`\`\`
      `,
    },

    severeFailureNotifiesCreator_v20260517_1: {
      title: "严重错误自动告知 creator",
      content: `
severe 失败时由系统向 creator 投递一条 inbox 消息告知失败原因。

设计原因：严重错误线程自身没机会再 think，由 system 代为通知，让上游决定如何兜底
（重试 / 派别的子线程 / 升级）。
      `,
    },

    duplicateTextDedup_v20260517_1: {
      title: "连续相同 text 去重",
      content: `
连续两轮若 assistant text 完全相同，thinkloop 做去重，不再追加重复 text event。

避免某种 LLM 退化模式（"echo loop"）撑爆 events / context。
      `,
    },

    serialToolDispatch_v20260517_1: {
      title: "多 tool call 串行执行",
      content: `
多个 tool call 按顺序串行执行，**不**做并发派发。

设计原因：tool 之间常隐式依赖（前一个 open 创建的 window 才能后一个 refine），
串行避免竞态；并发收益小于复杂性代价。
      `,
    },

    observableLoopMeta_v20260517_1: {
      title: "与 observable loop meta 对接",
      content: `
thinkloop 与 observable 的 beginLlmLoop / finishLlmLoop 对接；
pause / ok / error 三类结局都会进入 loop meta。

让 observability 层能逐轮回看（loop_NNNN.* 文件由 observable 在 begin/finish 时写）。
      `,
    },
  },

  collaboration_v20260517_1: {
    title: "与其他维度的协作",
    content: `
按 ThinkLoop 单轮 5 个阶段分别落到其它维度。详见子节点。
    `,

    perceive_v20260517_1: {
      title: "感知阶段",
      content: `
context-builder 组装 Context（详见 thinkable/context）。
      `,
    },

    think_v20260517_1: {
      title: "思考阶段",
      content: `
LLM Provider 抽象（Provider 接口由 thinkable/llm 实现）。
      `,
    },

    act_v20260517_1: {
      title: "行动阶段",
      content: `
tool calls 由 Engine handler 分派到 executable 维度。
      `,
    },

    record_v20260517_1: {
      title: "记录阶段",
      content: `
events 等数据的落盘由 storable / persistable 维度负责。
      `,
    },

    schedule_v20260517_1: {
      title: "调度阶段",
      content: `
Scheduler 决定下一个执行的线程（详见 thread/scheduler）。
      `,
    },
  },
};
