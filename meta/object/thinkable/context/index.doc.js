import { thinkable_v20260504_1 } from "@meta/object/thinkable/index.doc";
import * as contextSource from "@src/thinkable/context";
import * as contextTestSource from "@src/thinkable/__tests__/context.test";

export const context_v20260505_1 = {
  parent: thinkable_v20260504_1,
  sources: {
    context: contextSource,
    tests: contextTestSource,
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
  activeForms,         // 当前 open 但未 submit/close 的 form 列表（含每个 form 的任务描述与子待办）, 新建 thread 时的 requirement 会作为一个 form 出现，todo 也通过 form 表示

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
而是归并到 form 设计中——每个 form 自带任务描述与待办状态，由 activeForms 字段统一呈现。
详见 executable 文档

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

内容：本线程的 LLM 交互（message_in / message_out / tool_use / text / thinking）
       与上下文变化事件/提示

渲染：作为独立 LLM messages 输入，**不**混入 system prompt。
意义：稳定信息走 system prompt，历史交互作为 transcript 走 messages，符合主流 LLM 输入组织方式。

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

### activeForms

内容：每个 form 含
- 选择的 command
- form 里填写的 args
- form 标题、描述（form 创建时填入）
- 相关加载的 knowledge 标题列表

作用：提醒 LLM "你还有未完成的 open，可以继续 refine(填充参数) 或 submit/close"，

详见 executable 文档

#### todo 作为 form

todo 作为一类特殊的 command form：

- \`open(type=command, command=todo, ...)\`        创建一个 todo form，分配 form_id
- \`refine(form_id, { content: "…", on_command_path?: [...] })\`       更新待办内容和提醒条件
- \`submit(form_id)\`             视为该 todo 已处理，删除该 todo item

未 submit 的 todo form 会持续出现在 activeForms 中，自然成为 LLM 每轮可见的"待办"。
todo 的生命周期完全复用 form 生命周期，不需要单独的待办状态机。

线程新建时的初始 todo：
当一个线程被创建（root 由用户消息发起 / sub_thread 由 do(fork) 派生 / talk 进入），
系统会自动在该线程上注入一个 todo form，内容为"处理初始消息"——
让 LLM 第一轮就能在 activeForms 中看到这条待办，作为本线程任务的入口锚点。
处理完成后由 LLM 自行 submit 该 todo form 即可关闭。

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

2. **process event messages：上下文变化历史**
    - processEvents 数组转为独立 LLM messages（user/assistant/tool 角色）
`,
};
