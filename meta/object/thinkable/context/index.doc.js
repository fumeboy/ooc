import { thinkable_v20260504_1 } from "@meta/object/thinkable/index.doc";
import { process_events_v20260514_1 } from "@meta/object/thinkable/context/process-events.doc";
import * as contextEntry from "@src/thinkable/context";
import * as contextImpl from "@src/thinkable/context/index";
import * as contextRender from "@src/thinkable/context/render";
import * as windowTypes from "@src/executable/windows/types";

/**
 * Context 概念：Object 每次思考时看到的全部信息。
 *
 * sources:
 *  - contextEntry  — 顶层入口（re-export）
 *  - contextImpl   — ThreadContext / ProcessEvent / ThreadMessage type 定义 + buildInputItems
 *  - contextRender — XML system prompt 渲染层
 *  - windowTypes   — ContextWindow union 与各 window narrow type 定义（被 contextWindows 字段引用）
 */
export const context_v20260505_1 = {
  name: "Context",
  get parent() { return thinkable_v20260504_1; },
  sources: {
    contextEntry,
    contextImpl,
    contextRender,
    windowTypes,
  },
  description: `
Context 是 Object 每次思考时看到的全部信息。对象不知道 Context 之外的任何事情。

OOC 的 Context = **一组结构化信息窗口 + 一条 process events 消息流**。
信息窗口放入 system prompt，process events 作为独立 LLM messages 输入。

按子字段展开：

- isolation — Context 边界语义（对象世界的封闭性）
- composition — ThreadContext 顶层字段表
- fields — 各字段独立子节点详述
- specialReductions — 不作为独立字段、被收敛到其它结构的语义
- llmInput — system prompt + process event messages 两层拆分
`.trim(),

  isolation_v20260505_1: {
    title: "isolation",
    content: `
对象不知道 Context 之外的任何事情。Context 就是对象的全部世界。

任何"系统知道的事但 Context 里没体现"对该对象都不存在；反过来 Context 里
出现的所有结构都是该对象的合法感知面。这是 OOC 与 prompt-engineering Agent
的核心区别——Context 是封闭的、结构化的、可被对象自身读写的。
    `.trim(),
  },

  composition_v20260505_1: {
    title: "composition",
    content: `
\`\`\`
ThreadContext = {
  /* —— 主体 —— */
  name,                // Object 名称
  self,                // 我是谁 (self.md 正文)

  /* —— 任务 —— */
  creator,             // 线程创建者标识
  plan,                // 当前线程的计划
  contextWindows,      // 所有 ContextWindow

  /* —— 知识 —— */
  knowledge,           // 已激活的 knowledge（合成为 knowledge_window）

  /* —— 协作 —— */
  inbox,               // 其他 thread 投递的消息
  outbox,              // 当前 thread 发出的消息
  contact,             // 通讯录

  /* —— 过程 / 状态 —— */
  events,              // process event 流
  threadLocalData,     // 线程局部数据
  status,              // 调度状态
  env,                 // 环境信息
}
\`\`\`
    `.trim(),
  },

  fields_v20260505_1: {
    title: "fields",
    content: `
按层级分组：身份 / 任务 / 知识 / 协作 / 过程；每个字段独立子节点详述。
    `.trim(),

    self_v20260505_1: {
      title: "self",
      content: `
来源：stones/{name}/self.md 正文。内容：Object 的完整自我描述——目标 / 风格 /
知识背景 / 偏好。
      `.trim(),
    },

    creator_v20260505_1: {
      title: "creator",
      content: `
线程创建者的标识，让 Object 知道"任务是谁交给我的"。

取值规则：

- root thread：creator = "user"
- sub thread（do fork 派生）：creator = 父线程
- talk thread（跨对象派生）：creator = 发起 talk 的对象的那个 thread

完成任务后通过 \`open(parent_window_id=<creator talk_window id>, command="say", ...)\`
回报结果。详见 \`executable.concepts.creatorWindow\`。
      `.trim(),
    },

    plan_v20260505_1: {
      title: "plan",
      content: `
类型 string；LLM 通过 \`open(command="plan", args={plan: "..."})\` 自行 set / update。

用途：把"接下来打算怎么干"显式表达在 context 里，下一轮 LLM 看见自己的计划。
      `.trim(),
    },

    knowledge_v20260505_1: {
      title: "knowledge",
      content: `
来源：所有"已激活"的 knowledge 文档。

形态：合成为 \`type=knowledge\` 的 ContextWindow（不是独立顶层字段），按 source
区分 protocol / activator / explicit 三种渲染策略。

特别地：
- \`relations\` 自然作为 knowledge 出现（每个 \`relations/{peer}.md\` 是一篇 knowledge）
- 长期记忆 \`memory/index.md\` 也作为 knowledge 出现

激活规则与渲染上限详见 \`thinkable.knowledge\` 与 \`executable.concepts.knowledgeActivation\`。
      `.trim(),
    },

    inbox_v20260505_1: {
      title: "inbox",
      content: `
其他 thread 投递给当前 thread 的消息（含 messageId / fromThreadId / content /
source）。消息按发起方分组，组内按时间排序。
      `.trim(),
    },

    outbox_v20260505_1: {
      title: "outbox",
      content: `
当前 thread 发出的协作消息（含 messageId / windowId 等）。让 Object 看到
"我现在挂着哪些对外发起的对话"。
      `.trim(),
    },

    contextWindows_v20260505_1: {
      title: "context Windows",
      content: `
flat 数组，层级通过 \`parentWindowId\` 表达。当前 window 类型概览：

- **root** — 每个 thread 隐含；注册 root command 集合
- **command_exec** — 调用某 command 时的临时 sub-window
- **do** — fork 子线程后的对话窗口
- **talk** — 跨对象会话窗口
- **todo** — 可见待办
- **program** — REPL 风格代码执行窗口
- **file** / **knowledge** — 把文件 / 知识文档纳入 context
- **search** — glob / grep 结果

每种 type 的精确语义见 \`executable.concepts.contextWindow\` 与
\`executable.concepts.windows.*\`；type 定义本身由本概念 sources.windowTypes 绑定。
      `.trim(),
    },

    processEvents_v20260505_1: {
      title: "process Events",
      content: `
本线程的 process event 流（LLM 交互 + 上下文变化 + tool 运行结果）。

渲染：作为独立 LLM messages 输入，**不**混入 system prompt。

事件种类、字段定义与 transcript 转换规则详见子字段 \`context.processEvents\`。
      `.trim(),
    },

    threadLocalData_v20260505_1: {
      title: "thread Local Data",
      content: `
线程局部数据；program_window 的 ts / js exec 通过 \`self.getThreadLocal\` /
\`self.setThreadLocal\` 在多次 exec 之间共享数据。详见
\`executable.concepts.windows.programWindow\`。
      `.trim(),
    },

    status_v20260505_1: {
      title: "status",
      content: `
调度状态枚举：

- running — 可被 scheduler 选中执行下一轮 ThinkLoop
- waiting — 等 inbox 出现新消息（详见 \`thinkable.thread.scheduler\`）
- done — 任务完成；任意新 inbox 消息会自动翻回 running
- failed — 未捕获错误终止；任意新 inbox 消息也会翻回 running
- paused — 由控制面 pause；等待人工 resume（详见 \`observable.pause\`）

与 status 配套的字段：\`inboxSnapshotAtWait\`（入眠快照）+ \`waitingOn\`
（wait 引用的 window id，详见 \`executable.actions.tools.wait\`）。
      `.trim(),
    },

    contact_v20260505_1: {
      title: "contact",
      content: `
当前可见的其他 Object 的名称与其 \`readme.md\` 的 description（即"通讯录"）。
让 Object 知道"可以找谁说话"——cross-object talk 的 target 列表。

详见 \`thinkable.identity.outerReadme\` 与 collaborable 文档。
      `.trim(),
    },

    env_v20260505_1: {
      title: "env",
      content: `
环境配置：沙箱根路径 / 是否允许联网 / 是否允许执行 shell / 临时目录等。

作为程序执行 / 文件读写 / 工具调用的边界声明。
      `.trim(),
    },
  },

  specialReductions_v20260505_1: {
    title: "special Reductions",
    content: `
不作为 ThreadContext 独立顶层字段，但具有明确语义的几条"被收敛 / 兜底"规则。
每条对应一个具名子节点：
    `.trim(),

    taskAndSubtodosReducedToWindows_v20260505_1: {
      title: "task And Subtodos Reduced To Windows",
      content: `
线程的"任务说明"和"子待办列表"不作为 ThreadContext 的独立字段——统一收敛为
ContextWindow：

- 每个 do_window 自带任务上下文（\`targetThreadId\` + transcript）
- 每个 todo_window 自带 \`content\` + 可选 \`onCommandPath\` 强提醒
- 不再有"thread.task" / "thread.todos" 这种隔离字段

设计原因：让"持续占 context 的实体"由统一 window 抽象承担，避免 thread 字段
表与 window 列表两套并行结构。详见 \`executable.concepts.contextWindow\`。
      `.trim(),
    },

    inboxOutboxFallbackRendering_v20260505_1: {
      title: "inbox Outbox Fallback Rendering",
      content: `
绝大多数 inbox / outbox 消息被某个 talk_window 或 do_window 的 transcript 视图
**收纳渲染**；未被任何 window 收纳的"剩余消息"走 context 顶层 \`<inbox>\` /
\`<outbox>\` **兜底渲染**，避免 LLM 漏掉任何消息。

这是 render 层的兜底机制——窗口视图覆盖优先，兜底节点仅承担窗口未覆盖的余量。
具体过滤逻辑见 \`contextRender\` source 中的 \`renderMessagesNode\` 与
\`filterMessagesForTalkWindow\` / \`filterMessagesForDoWindow\`。
      `.trim(),
    },

    knowledgeWindowSynthesis_v20260505_1: {
      title: "knowledge Window Synthesis",
      content: `
\`knowledge\` 字段不是独立的顶层字段，而是合成为 \`type=knowledge\` 的
ContextWindow 出现在 \`contextWindows\` 中。三种 source（protocol / activator /
explicit）由 \`buildInputItems\` 调 \`collectExecutableKnowledgeEntries\` 在每轮
合成；其中 protocol / activator 来源**不持久化**，每轮重新计算。

详见 \`executable.concepts.knowledgeActivation\`。
      `.trim(),
    },
  },

  llmInput_v20260505_1: {
    title: "llm Input",
    content: `
每轮 LLM 输入分两层，对应 \`buildContext\` / \`buildInputItems\` 实现。详见两个
独立子节点。
    `.trim(),

    systemPromptLayer_v20260505_1: {
      title: "system prompt：\\`<context>\\` 信息窗口",
      content: `
上述所有字段（除 events 外）按 XML 子标签序列渲染。

渲染器带 XML 转义、CDATA 包装、comment 清洗与体积截断：

- knowledge 正文按 8KB 截断
- file window 正文按 32KB 截断

file window 直接读取文件正文进入 \`<content>\`；knowledge window 按 source
渲染 path / description / body。
      `.trim(),
    },

    transcriptLayer_v20260505_1: {
      title: "process event messages：上下文变化历史",
      content: `
events 数组转为独立 LLM messages（user / assistant / tool 角色）；
function_call 与 function_call_output 作为一等 item 而非文本回放。

provider 适配层负责把这条统一 message 序列翻译成各自 wire format
（详见 \`thinkable.llm.toolUseEncoding\`）。
      `.trim(),
    },

    layerBoundary_v20260505_1: {
      title: "两层边界约定",
      content: `
\`<context>\` 中的 system message **永远**是稳定状态快照（"我现在拥有什么"）；
events messages **永远**是历史轨迹（"我做了什么"）。

两层互不混用：

- system 不复述 transcript 已有的 tool 调用历史（否则 LLM 看到自己重复说一遍会困惑）
- transcript 不重复 system 已有的 window 状态（否则 transcript 体积失控）

这条边界让 system 在长跑线程里仍保持可控大小，并让 LLM 不在 transcript 中
复述自己已经在 system 里看到的状态。
      `.trim(),
    },
  },

  processEvents: process_events_v20260514_1,
};
