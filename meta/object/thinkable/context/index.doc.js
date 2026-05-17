import { thinkable_v20260504_1 } from "@meta/object/thinkable/index.doc";
import { process_events_v20260514_1 } from "@meta/object/thinkable/context/process-events.doc";
import * as contextEntry from "@src/thinkable/context";
import * as contextImpl from "@src/thinkable/context/index";
import * as contextRender from "@src/thinkable/context/render";

/**
 * Context 概念：Object 每次思考时看到的全部信息。
 *
 * sources:
 *  - contextEntry  — 顶层入口（re-export）
 *  - contextImpl   — ThreadContext / ProcessEvent / ThreadMessage type 定义 + buildInputItems
 *  - contextRender — XML system prompt 渲染层（包括 window-type-aware 渲染、CDATA 包装、体积截断）
 */
export const context_v20260505_1 = {
  name: "Context",
  get parent() { return thinkable_v20260504_1; },
  sources: {
    contextEntry,
    contextImpl,
    contextRender,
  },
  description: `
Context 是 Object 每次思考时看到的全部信息。

**对象不知道 Context 之外的任何事情。Context 就是对象的全部世界。**

OOC 的 Context = **一组结构化信息窗口 + 一条 process events 消息流**。
信息窗口放入 system prompt，process events 作为独立 LLM messages 输入。

按子字段展开：

- composition — ThreadContext 顶层字段表
- fields — 每个字段的语义（self / creator / plan / knowledge / inbox-outbox / contextWindows / processEvents / locals / status / contact / env）
- llmInput — system prompt + process event messages 两层拆分与渲染规则
`.trim(),

  composition_v20260505_1: {
    index: `
## Context 的组成

\`\`\`
ThreadContext = {
  /* —— 主体 —— */
  name,                // Object 名称
  self,                // 我是谁 (self.md 正文)

  /* —— 任务 —— */
  creator,             // 线程创建者标识（user / 父线程 ID / 外部对象名）
  plan,                // 当前线程的计划 (通过 plan command 设置)
  contextWindows,      // 所有 ContextWindow（root 隐含 + command_exec form +
                       //   talk_window / do_window / todo_window / program_window /
                       //   file_window / knowledge_window / search_window）

  /* —— 知识 —— */
  knowledge,           // 所有"已激活"的 knowledge 文档（合成为 knowledge_window）

  /* —— 协作 —— */
  inbox,               // 其他 thread 投递给当前 thread 的消息
  outbox,              // 当前 thread 发出的协作消息
  contact,             // 通讯录（同上下文中可见的其他 Object）

  /* —— 过程 / 状态 —— */
  events,              // process event 流：LLM 交互 + 上下文变化 + tool 运行结果
  threadLocalData,     // 线程局部数据（program_window 的 ts/js exec 通过 self.getThreadLocal/setThreadLocal 共享）
  status,              // 调度状态：running / waiting / done / failed / paused
  env,                 // 环境信息（沙箱路径、能力开关等）
}
\`\`\`

线程的"任务说明"和"子待办列表"不作为 ThreadContext 的独立字段——统一收敛为
ContextWindow：每个 do_window 自带任务上下文（targetThreadId + transcript），
todo_window 自带 content + onCommandPath。详见 \`executable.concepts.contextWindow\`。
`.trim(),
  },

  fields_v20260505_1: {
    index: `
## 字段语义总览

按层级分组：身份 / 任务 / 知识 / 协作 / 过程；每个字段在下方独立子节点详述。
`.trim(),

    self_v20260505_1: {
      index: `
### self

- 来源：\`stones/{name}/self.md\` 正文
- 内容：Object 的完整自我描述——目标、风格、知识背景、偏好
`.trim(),
    },

    creator_v20260505_1: {
      index: `
### creator

线程创建者的标识，让 Object 知道"任务是谁交给我的"。

取值：
- root thread：creator = "user"
- sub thread（do fork 派生）：creator = 父线程
- talk thread（跨对象派生）：creator = 发起 talk 的对象的那个 thread

完成任务后通过 \`open(parent_window_id=<creator talk_window id>, command="say", ...)\`
回报结果。详见 \`executable.concepts.creatorWindow\`。
`.trim(),
    },

    plan_v20260505_1: {
      index: `
### plan

- 类型：string
- 写入：LLM 通过 \`open(command="plan", args={plan: "..."})\` 自行 set / update
- 用途：把"接下来打算怎么干"显式表达在 context 里，下一轮 LLM 看见自己的计划
`.trim(),
    },

    knowledge_v20260505_1: {
      index: `
### knowledge

- 来源：所有"已激活"的 knowledge 文档
- 形态：合成为 \`type=knowledge\` 的 ContextWindow（不是独立顶层字段），按 source
  区分 protocol / activator / explicit 三种渲染策略

特别地：
- \`relations\` 自然作为 knowledge 出现（每个 \`relations/{peer}.md\` 是一篇 knowledge）
- 长期记忆 \`memory/index.md\` 也作为 knowledge 出现

激活规则与渲染上限详见 \`thinkable.knowledge\` 与 \`executable.concepts.knowledgeActivation\`。
`.trim(),
    },

    inboxOutbox_v20260505_1: {
      index: `
### inbox / outbox

inbox：其他 thread 投递给当前 thread 的消息（含 messageId / fromThreadId /
content / source）；消息按发起方分组，组内按时间排序。

outbox：当前 thread 发出的协作消息（含 messageId / windowId 等）；
让 Object 看到"我现在挂着哪些对外发起的对话"。

绝大多数 inbox / outbox 消息被某个 talk_window 或 do_window 的 transcript 视图
收纳渲染；未被收纳的剩余消息走 context 顶层 \`<inbox>\` / \`<outbox>\` 兜底渲染，
避免 LLM 漏掉任何消息。详见 collaborable 文档。
`.trim(),
    },

    contextWindows_v20260505_1: {
      index: `
### contextWindows

flat 数组，层级通过 \`parentWindowId\` 表达。当前 window 类型：

- **root**：每个 thread 隐含；注册 do / talk / program / plan / end / todo /
  open_file / open_knowledge / glob / grep / write_file 等 root command
- **command_exec**：调用某 command 时的临时 sub-window，承载 args 累积与
  knowledge 渐进激活；成功 submit 后系统自动从 contextWindows 移除；失败保留待 close
- **do**：fork 子线程后产生的对话窗口；transcript 是 inbox/outbox 在
  targetThreadId 视角的视图；\`isCreatorWindow=true\` 的 do 是指向 creator 的初始
  对话通道，不可被 LLM close
- **talk**：跨对象会话窗口；同一 target 在同一 thread 内复用一个 talk_window
- **todo**：可见待办；由 \`open(command="todo", ...)\` 直建
- **program**：REPL 风格代码执行窗口；history 保留每次 exec
- **file** / **knowledge**：把文件 / 知识文档纳入 context
- **search**：glob / grep 结果留作可被 open_match 引用的持久窗口

XML 渲染示例：

\`\`\`xml
<context_windows>
  <window id="w_creator_root" type="do" status="running">
    <title>处理初始消息</title>
    <target_thread>__session__</target_thread>
    <is_creator_window>true</is_creator_window>
    <transcript>...</transcript>
  </window>
  <window id="f_xx" type="command_exec" status="open">
    <title>制定计划</title>
    <command>plan</command>
    <accumulated_args>{"plan":"先 reshape"}</accumulated_args>
    <command_paths><path>plan</path></command_paths>
  </window>
</context_windows>
\`\`\`

详见 \`executable.concepts.contextWindow\` 与 \`executable.concepts.windows.*\`
各 window type 的精确语义；类型定义在 \`@src/executable/windows/types.ts\`。
`.trim(),
    },

    processEvents_v20260505_1: {
      index: `
### events (process events)

- 内容：本线程的 process event 流（LLM 交互 + 上下文变化 + tool 运行结果）
- 渲染：作为独立 LLM messages 输入，**不**混入 system prompt
- 意义：稳定信息走 system prompt，历史交互作为 transcript 走 messages，符合主流
  LLM 输入组织方式

事件种类、字段定义与 transcript 转换规则详见子文档 \`context.processEvents\`。
`.trim(),
    },

    threadLocalData_v20260505_1: {
      index: `
### threadLocalData

线程局部数据；program_window 的 ts / js exec 通过 \`self.getThreadLocal\` /
\`self.setThreadLocal\` 在多次 exec 之间共享数据。详见
\`executable.concepts.windows.programWindow\`。
`.trim(),
    },

    status_v20260505_1: {
      index: `
### status

调度状态枚举：

- running — 可被 scheduler 选中执行下一轮 ThinkLoop
- waiting — 等 inbox 出现新消息（详见 \`thinkable.thread.scheduler\`）
- done — 任务完成；任意新 inbox 消息会自动翻回 running
- failed — 未捕获错误终止；任意新 inbox 消息也会翻回 running
- paused — 由控制面 pause；等待人工 resume（详见 \`observable.pause\`）

与 status 配套的字段：\`inboxSnapshotAtWait\`（入眠快照）+ \`waitingOn\`（wait 引用的
window id，详见 \`executable.actions.tools.wait\`）。
`.trim(),
    },

    contact_v20260505_1: {
      index: `
### contact

- 内容：当前可见的其他 Object 的名称与其 \`readme.md\` 的 description（即"通讯录"）
- 用途：让 Object 知道"可以找谁说话"——cross-object talk 的 target 列表

详见 \`thinkable.identity.outerReadme\` 与 collaborable 文档。
`.trim(),
    },

    env_v20260505_1: {
      index: `
### env

环境配置：

- 内容：沙箱根路径、是否允许联网、是否允许执行 shell、临时目录等
- 作用：作为程序执行 / 文件读写 / 工具调用的边界声明
`.trim(),
    },
  },

  llmInput_v20260505_1: {
    index: `
## LLM Input 拆分

每轮 LLM 输入分两层：

1. **system prompt：\`<context>\` 信息窗口**
   - 上述所有字段（除 events 外）按 XML 子标签序列渲染
   - 渲染器带 XML 转义、CDATA 包装、comment 清洗与体积截断：knowledge 正文
     按 8KB 截断，file window 正文按 32KB 截断
   - file window 直接读取文件正文进入 \`<content>\`；knowledge window 按 source
     渲染 path / description / body

2. **process event messages：上下文变化历史**
   - events 数组转为独立 LLM messages（user / assistant / tool 角色）；
     function_call 与 function_call_output 作为一等 item 而非文本回放
   - provider 适配层负责把这条统一 message 序列翻译成各自 wire format
     （详见 \`thinkable.llm.toolUseEncoding\`）

边界：\`<context>\` 中的 system message 永远是稳定状态快照（"我现在拥有什么"），
events messages 永远是历史轨迹（"我做了什么"）；两层互不混用。
`.trim(),
  },

  processEvents: process_events_v20260514_1,
};
