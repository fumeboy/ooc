import { thinkable_v20260504_1 } from "@meta/object/thinkable/index.doc";
import { process_events_v20260514_1 } from "@meta/object/thinkable/context/process-events.doc";
import * as contextSource from "@src/thinkable/context";

// doc 仅绑定实现源代码，不再绑定 .test.ts —— 测试文件包含 bun:test 运行时依赖，
// 顶层 import "meta/index.doc.js" 时会触发 "describe outside test runner" 错误。
// 测试文件本身可通过 src/**/__tests__/ 路径直接发现，不需要在 doc 里再 alias。
export const context_v20260505_1 = {
  get parent() { return thinkable_v20260504_1; },
  sources: {
    context: contextSource,
  },
  index: `
Context 是 Object 每次思考时看到的全部信息。

**对象不知道 Context 之外的任何事情。Context 就是对象的全部世界。**

OOC 的 Context = **一组结构化信息窗口 + 一条 process events 消息流**。
信息窗口放入 system prompt，process events 作为独立 LLM messages 输入。

## Context 的组成

\`\`\`
ThreadContext = {
  /* —— 主体 —— */
  name,                // Object 名称
  self,              // 我是谁 (self.md 正文)

  /* —— 任务 —— */
  creator,             // 线程创建者标识（user / 父线程 ID / 外部对象名）:  记录用于告诉 LLM 把结果发送给谁
  plan,                // 当前线程的计划 (通过 plan 这个 command 设置)
  contextWindows,      // 所有 ContextWindow（root 隐含 + command_exec form + do_window + todo_window）, 替代旧 activeForms / pinnedKnowledge / windows 三套字段
                       // 详见 spec docs/superpowers/specs/2026-05-14-context-window-unification-design.md

  /* —— 知识 —— */
  knowledge,           // 所有"已激活"的 knowledge 文档

  /* —— 协作 —— */
  inbox,               // 其他 thread 和自己的交互消息（含 messageId，按 thread 分组，按时间排序）
  outbox,              // 自己创建的 thread 的交互消息（含 messageId）
  contact,             // 通讯录（同上下文中可见的其他 Object）

  /* —— 过程 / 状态 —— */
  processEvents,       // 当前线程的 LLM 交互与上下文变化历史
  locals,              // 线程局部变量 (名称 + 描述 + 简短值展示)
  status,              // 线程状态
  env,                 // 环境信息（沙箱路径、能力开关等）
}
\`\`\`

注：线程的"任务说明"和"子待办列表"不作为 ThreadContext 的独立字段，
而是统一收敛为 ContextWindow——每个 do_window 自带任务上下文（targetThreadId + transcript），
todo_window 自带 content + onCommandPath；详见 executable 文档与 spec 2026-05-14。

## 字段语义

### self

来源：stones/{name}/self.md 正文
内容：Object 的完整自我描述——目标、风格、知识背景、偏好

### knowledge

来源：所有"已激活"的 knowledge 文档（按 namespace 分组渲染）
具有 "展示正文 / 仅描述" 等不同的展示状态

特别地：
- relations 自然作为 knowledge 出现（每个 relations/{peer}.md 是一篇 knowledge）
- 长期记忆 memory/index.md 也作为 knowledge 出现

### creator

取值：
- 对于 root thread：creator = "user"
- 对于 sub thread：creator = 线程发起方的那个 thread（不是父线程）
- 对于 talk thread：creator = 发起 talk 的对象的那个 thread

让 Object 知道"这个任务是谁交给我的"——任务完成后通过 talk(target=creator, ...) 把结果送回。

### plan

内容：线程的 plan 文本，由 LLM 通过 plan command 自行 set/update

### processEvents

内容：本线程的 process event 历史，记录 LLM 交互、上下文变化与 tool 运行结果。

渲染：作为独立 LLM messages 输入，**不**混入 system prompt。
意义：稳定信息走 system prompt，历史交互作为 transcript 走 messages，符合主流 LLM 输入组织方式。

process event 的事件种类、字段定义与 transcript 转换规则，详见子文档 [process-events](./process-events.doc.js)。

### locals

通过 command \`program\` 可以执行 ts/js 脚本，在脚本中可以访问 locals 对象写入数据，用于后续流程复用数据

### status

枚举：running / waiting / done / failed
作用：让 Context 自带"我现在处于什么状态"的元信息

### inbox

内容：其他发来的消息的线程 以及 那个线程和当前线程的交互 messages
字段：每条消息含 messageId / from(消息来源) / content / marked(消息标记) (ack / ignore / todo / null)

消息按发起线程分组，组内按时间排序。详见 collaborable 文档。

### outbox

内容：本线程主动创建的子线程 (包括主动 talk 出去的线程) 的交互记录
字段：每条记录含目标线程 ID / 对方对象名 / messages
作用：让 Object 看到"我现在挂着哪些对外发起的对话"

### contextWindows

Step 1（spec 2026-05-14）后取代旧 activeForms / pinnedKnowledge / thread.windows。

flat 数组，层级通过 \`parentWindowId\` 表达。当前 step 1 范围下的 4 种 window：

- **root**：每个 thread 隐含；注册全局 command（do/talk/program/plan/end/todo）
- **command_exec**：调用某 command 时的临时 sub-window，承载 args 累积与 knowledge 渐进激活；
  成功 submit 后系统自动从 contextWindows 移除；失败保留待 close
- **do**：fork 子线程后产生的对话窗口；transcript 是 inbox/outbox 在 targetThreadId 视角的视图；
  特例 \`isCreatorWindow=true\` 是初始 creator do_window，不可被 LLM close
- **todo**：由 root.todo command 通过 C 规则直建的可见待办

XML 渲染示例（\`<context_windows>\` 顶级节点，每个 window 含 sub_windows）：

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

详见 executable 文档与 src/executable/windows/types.ts。

#### todo 不再依赖 form 生命周期

旧实现中 todo 是"永远不 submit 的 form"——用 form 的 open 状态表达"未完成"。
Step 1 之后 todo_window 是独立 window 类型，由 \`open(command="todo", title=..., args={ content, on_command_path? })\`
触发 C 规则直建。完成时 \`close(window_id="<todo_window_id>", reason=...)\`。

线程新建时的 creator do_window 取代了"自动注入处理初始消息 todo form"——
任何新 thread 创建时系统自动挂一个 \`isCreatorWindow=true\` 的 do_window 指向 creator，
LLM 一上来就能在 contextWindows 中看到与 creator 的对话视角。

### contact

内容：当前可见的其他 Object 的名称与其 readme.md 的 description（即"通讯录"）
作用：让 Object 知道"可以找谁说话"

### env

环境配置
内容：沙箱根路径、是否允许联网、是否允许执行 shell、临时目录等
作用：作为程序执行 / 文件读写 / 工具调用的边界声明

## LLM Input 拆分

每轮 LLM 输入分两层：

1. **system prompt：\`<context>\` 信息窗口**
    - 上述所有字段（除 processEvents 外）按 XML 子标签序列渲染
    - 当前渲染器不是简单字符串拼接，而是带 XML 转义、CDATA 包装、comment 清洗与体积截断：knowledge 正文按 8KB 截断，file window 正文按 32KB 截断
    - file window 会直接读取文件正文进入 \`<content>\`；knowledge window 当前只显示 path/description，正文仍通过 active knowledge 渲染进入 context

2. **process event messages：上下文变化历史**
    - processEvents 数组转为独立 LLM messages（user/assistant/tool 角色）
`,
  processEvents: process_events_v20260514_1,
};
