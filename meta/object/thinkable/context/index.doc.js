import { thinkable_v20260504_1 } from "@meta/object/thinkable/index.doc";

export const context_v20260505_1 = {
    parent: thinkable_v20260504_1,
    index: `
Context 是 Object 每次思考时看到的全部信息。

**对象不知道 Context 之外的任何事情。Context 就是对象的全部世界。**

OOC 的 Context = **一组结构化信息窗口 + 一条 process events 消息流**。
信息窗口放入 system prompt，process events 作为独立 LLM messages 输入。

## Context 的字段集

\`\`\`
ThreadContext = {
  /* —— 主体 —— */
  name,                // Object 名称
  whoAmI,              // 我是谁 (readme.md 正文)
  knowledge,           // 已激活的 knowledge 文档集合（含吸收 relations / memory）
  scopeChain,          // 当前线程沿树向上收集的已激活 knowledge 链

  /* —— 任务 —— */
  creator,             // 创建者标识（user / 父线程 ID / 外部对象名）
  plan,                // 当前计划（线程局部）

  /* —— 过程 / 状态 —— */
  processEvents,       // 当前线程的 LLM 交互与上下文变化历史
  locals,              // 线程局部变量 (名称 + 描述 + 简短值展示)
  status,              // 线程状态

  /* —— 协作 —— */
  inbox,               // 其他 thread 和自己的交互消息（含 messageId，按 thread 分组，按时间排序）
  outbox,              // 自己创建的 thread 的交互消息（含 messageId）

  /* —— 进行中的动作 —— */
  activeForms,         // 当前 open 但未 submit/close 的 form 列表（含每个 form 的任务描述与子待办）, 新建 thread 时的 requirement 会作为一个 form 出现，todo 也通过 form 表示
  defers,              // 当前线程注册的 command hook

  /* —— 资源 —— */
  contact,             // 通讯录（同上下文中可见的其他 Object）
  env,                 // 环境信息（沙箱路径、能力开关等）
}
\`\`\`

注：线程的"任务说明"和"子待办列表"不再作为 ThreadContext 的独立字段，
而是归并到 form 设计中——每个 form 自带任务描述与待办状态，由 activeForms 字段统一呈现。
详见 executable/forms。

## 字段语义

### whoAmI

来源：stones/{name}/readme.md 正文（thinkable.whoAmI）
内容：Object 的完整自我描述——目标、风格、知识背景、偏好

### knowledge

来源：所有"已激活"的 knowledge 文档（按 namespace 分组渲染）
具有 "完整正文 / 仅描述" 等不同的 visibility 状态

激活路径：
- scope chain 沿线程树向上收集（父线程激活的 knowledge 对子线程可见）
- 当前线程的 form open/refine 触发 activates_on 命中
- LLM 显式 open(type=knowledge, name=...) 手动 pin

未激活但可见的 knowledge：仅注入 description（让 LLM 知道"有这个，可手动 open"）

特别地：
- relations 自然作为 knowledge 出现（每个 relations/{peer}.md 是一篇 knowledge）
- 长期记忆 memory/index.md 也作为 knowledge 出现（截尾上限保护，详见 reflectable）

### scopeChain

来源：从根线程到当前节点的路径上，所有节点的 \`node.knowledge + node.activatedKnowledge\` 合并去重
作用：决定 knowledge 字段实际渲染哪些文档

### creator

来源：节点的 creator 字段
取值：
- root：creator = "user"
- sub_thread：creator = 父线程 ID
- talk：creator = 发起 talk 的对象名

让 Object 知道"这个任务是谁交给我的"——任务完成后通过 talk(target=creator, ...) 把结果送回。

### plan

来源：threadData.plan
内容：线程局部的计划文本，由 LLM 通过 plan command 自行 set/update

### processEvents

来源：threadData.events 数组
内容：本线程的 LLM 交互（message_in / message_out / tool_use / text / thinking）
       与上下文变化（inject / program / plan / create_thread / mark_inbox / compress_summary）

渲染：作为独立 LLM messages 输入，**不**混入 system prompt。
意义：稳定信息走 system prompt，历史交互作为 transcript 走 messages，符合主流 LLM 输入组织方式。

### locals

来源：threadData.locals
内容：line/program 写入的局部状态键值对

### status

来源：节点 status (running / waiting / done / failed)
作用：让 Context 自带"我现在处于什么状态"的元信息

### inbox

来源：threadData.inbox
内容：其他线程发来的消息（含同对象的父/兄/子线程、其他对象 talk 进来）、系统通知
字段：每条消息含 messageId / from / content / marked (ack / ignore / todo / null)

按发起线程分组，组内按时间排序。详见 collaborable 维度。

### outbox

来源：threadData.outbox
内容：本线程主动创建的子线程 / 主动 talk 出去的线程的交互记录
字段：每条记录含目标线程 ID / 对方对象名 / 最近 message
作用：让 Object 看到"我现在挂着哪些对外发起的对话"

### activeForms

来源：当前 FormManager 中 open 但未 submit/close 的 form 列表
内容：每个 form 含
- 选择的 command 与 method
- 当前累积的 args
- 任务描述（form 创建时填入）
- 子待办列表（form 内部的 step / pending todo）
- visibility / 已加载 knowledge

作用：提醒 LLM "你还有未完成的 open，可以继续 refine 或 submit/close"，
      同时承载本来在 ThreadContext 一级的"任务说明 + 待办"信息。

详见 executable/forms。

#### TODO 作为 form

TODO 不是独立字段，而是一类特殊的 form：

- \`open(type=todo, ...)\`        创建一个 todo form，分配 form_id
- \`refine(form_id, args)\`       更新该 todo 的 tip 文本、开关（done / pending / 暂缓 等）
- \`submit(form_id)\`             视为该 todo 已处理，删除该 todo form

未 submit 的 todo form 会持续出现在 activeForms 中，自然成为 LLM 每轮可见的"待办"。
要批量管理时，对每个 todo 单独 open/refine/submit 即可——
todo 的生命周期完全复用 form 生命周期，不需要单独的待办状态机。

线程新建时的初始 todo：
当一个线程被创建（root 由用户消息发起 / sub_thread 由 do(fork) 派生 / talk 进入），
系统会自动在该线程上注入一个 todo form，内容为"处理初始消息"——
让 LLM 第一轮就能在 activeForms 中看到这条待办，作为本线程任务的入口锚点。
处理完成后由 LLM 自行 submit 该 todo form 即可关闭。

### defers

来源：当前线程注册的 on:<command> hook
作用：让 LLM 在执行前看到"如果我做 X，会同时触发 Y 提醒"

详见 executable/actions/commands/defer。

### contact

来源：调用方传入的 Object 列表，过滤掉自身
内容：当前可见的其他 Object 的名称与 talkable.whoAmI（即"通讯录"）
作用：让 Object 知道"可以找谁说话"

### env

来源：调用方传入的环境配置
内容：沙箱根路径、是否允许联网、是否允许执行 shell、临时目录等
作用：作为程序执行 / 文件读写 / 工具调用的边界声明

## LLM Input 拆分

每轮 LLM 输入分两层：

1. **system prompt：\`<context>\` 信息窗口**
    - 上述所有字段（除 processEvents 外）按 XML 子标签序列渲染
    - 子标签序列：identity / knowledge / creator / plan / inbox / outbox / activeForms / defers / status / contact / env
    - 这些信息描述"当前世界长什么样"

2. **process event messages：上下文变化历史**
    - processEvents 数组转为独立 LLM messages（user/assistant/tool 角色）
    - 历史交互作为可裁剪的 transcript 进入模型

## 容量管理：三层

Context 容量有限。Object 的历史被压缩为三层：

| 层次 | 物理存储 | 生命周期 | 进入 Context 的位置 |
|---|---|---|---|
| **long-term** | stones/{name}/knowledge/memory/index.md + memory/entries/*.json | 永久，跨所有任务 | knowledge 字段中的 memory 窗口（截尾上限保护） |
| **session**   | flows/{sid}/objects/{name}/memory.md | 当前 Session | session memory 段（任务结束随 session 消散） |
| **recent**    | flows/{sid}/objects/{name}/threads/{tid}/thread.json 的 events | 线程级 | processEvents 字段（token 超阈值时由 LLM 通过 compress 选择性截断） |

写入路径：
- long-term：通过 super 分身的 SuperFlow 通道写入（详见 reflectable/super-flow）
- session：Flow 主动写 memory.md
- recent：每轮 ThinkLoop 自动追加 events

读取路径：均由 context-builder 自动汇集到对应字段。

## 容量管理：scope chain（空间维度过滤）

线程树向上收集时，只有作用域内的 knowledge 可见。
子线程不会自动看到兄弟线程的 events / inbox / activeForms。

详见 thread/index 的"Scope Chain"段落。

## 容量管理：渐进式 knowledge 激活（按需加载）

不是所有 knowledge 都始终注入。每篇 knowledge 通过 frontmatter 的 activates_on
声明"在哪些 command 路径下显示描述 / 完整加载"。

详见 thinkable/knowledge。

## Process Event 类型

进入 processEvents 的事件分两类：

- **llm_interaction**（LLM 交互过程）
    - message_in       接收消息（其他线程 talk / 系统通知）
    - message_out      发出消息
    - text             LLM 正文输出
    - tool_use         LLM 调用 tool
    - thinking         LLM 思考过程（仅记录，不进入下一轮 Context）

- **context_change**（上下文变化提示）
    - inject           系统注入消息（错误、提醒、外部事件）
    - program          程序执行结果
    - plan             计划更新
    - create_thread    创建子线程
    - mark_inbox       inbox 消息标记
    - compress_summary 压缩占位（替代被截断的 events 区段）
`,
};
