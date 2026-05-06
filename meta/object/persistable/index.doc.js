import { object_v20260504_1 } from "@meta";

export const persistable_v20260504_1 = {
    parent: object_v20260504_1,
    index: `
Persistable 描述 Object 如何在文件系统中存在。

OOC 的核心断言：**对象的持久化目录就是它的物理存在**。
- 目录存在 → 对象存在
- 目录被删除 → 对象消亡
- 目录被复制/迁移 → 对象搬家
- 修改目录里的文件 → 对象自身的属性/能力立即改变

不存在"内存里的对象"——任何时候说"对象 X"，指的都是文件系统上某个目录。

为什么是文件系统而不是数据库？
- 可读：人类能直接打开、查看、备份
- 可写：对象可以修改自己的身份、数据、能力
- 可引用：路径即地址，可被其他对象（或 LLM）引用
- 可归档：目录能复制、删除、迁移

数据库不可读、内存变量无持久化、vector store 无稳定地址——只有文件系统四者俱全。

存在的两个基本形态:
- stone
    - 静态形态 / 潜能态
    - 表示这个 Object 的长期身份、数据、knowledge、memory
- flow / session
    - 动态形态 / 现实态
    - 表示这个 Object 在某个 session 的运行过程

stone 持久化的核心文件:
/stones/{objectId}/
- .stone.json
    配置文件 & 标识这是一个 stone 目录
- self.md
    对象身份与自我说明
- knowledge
    知识库
- knowledge/.knowledge.json
    知识库配置文件, 比如用于配置对其他文件路径的文件的引用
- knowledge/{dirName}
    知识库目录下允许有多级子目录，只为了便于管理文档，无特别含义
- knowledge/**/*.md
    知识文档，具有 yaml frontmatter 格式头
- knowledge/memory/
    跨任务保留的记忆，目录结构类似于 knowledge
- knowledge/memory/index.md
    记忆索引页 + 最近记忆
- knowledge/relations/
    关系文档
- knowledge/relations/self.md
    向其他对象介绍自己的文档
- knowledge/relations/{objectId}.md
    和其他 Object 的关系文档
- data.json
    Object 所具有的属性、数据
- server/
    Object 所具有的方法程序
- server/index.ts  
    路由注册层，声明哪些函数可以被 LLM "看见"、声明哪些函数可以被前端访问
- client/
    React UI 页面
- client/index.tsx
    首页
- files
    其他文件


flow 持久化的文件:
/flows/{sessionId}/objects/{objectId}/
- .flow.json
    配置文件 & 标识这是一个 flow object 目录
- 除了没有 self.md，复用和上述 stone 一样的目录结构 (stone + flow 的数据共同组合为 session 下的 object 数据)
- threads/
    线程目录
- threads/{threadId}/thread.json
    线程数据
- threads/{threadId}/debug/llm.context.xml
    debug 数据， 默认要产出，构造的 context，每次请求 LLM 前写入该文件
    相关设计可以见 observable 文档
- threads/{threadId}/debug/llm.messages.json
    debug 数据， 默认要产出，构造的 llm messages, 每次请求 LLM 前写入该文件
- threads/{threadId}/debug/llm.output.json
    debug 数据， 默认要产出，LLM 输出内容
- threads/{threadId}/debug/loop.1.context.xml
    debug 数据， 第一轮的 context ，开启 debug 模式后记录每一轮的上述三个 debug 文件


## 形态：Stone 与 Flow（势能 vs 动能）

Stone 与 Flow 不是"低级 vs 高级"，而是**同一对象的两种形态**——如同物质的势能与动能。

\`\`\`
Stone（石头）                    Flow（流）
──────────                       ──────────
静态 / 潜能态                    动态 / 现实态
能力已定义，未激活               ThinkLoop 正在运行
"可以思考的东西"                 "正在思考的东西"
不会主动做任何事                 持续思考、行动、改变
\`\`\`

Stone 像一块刻了字的石头：信息在那里，但石头不会自己读出来。
Flow 是 Stone 被一个具体任务唤醒后的活体。

| 维度 | Stone | Flow |
|---|---|---|
| 存储位置 | \`stones/{name}/\` | \`flows/{sessionId}/objects/{name}/\` |
| 标记文件 | \`.stone.json\` | \`.flow.json\` |
| 生命周期 | 跨越所有任务，永久存在 | 仅当前 Session 有效 |
| 思考能力 | 无（不调用 LLM） | 有（ThinkLoop 主动调用 LLM） |
| 自主行动 | 否 | 是 |
| 数量限制 | 一个 name 一个 Stone | 一个 Stone 可派生多个 Flow（每 session 一个） |

### 为什么"一个 Stone 多个 Flow"

一个对象可能同时处理多个任务：

\`\`\`
stones/alan/                              ← 唯一的 Alan Stone
  └── （唯一的身份、knowledge、server、client）

flows/sess_A/objects/alan/    ← Session A 中的 Alan Flow（处理任务 A）
flows/sess_B/objects/alan/    ← Session B 中的 Alan Flow（处理任务 B）
flows/sess_C/objects/alan/    ← Session C 中的 Alan Flow（处理任务 C）
\`\`\`

三个 Flow **共享同一个 Stone 的身份和能力**，但各自有独立的运行时状态
（线程树、inbox、当前思考），让对象可以并发处理多个任务而不混淆上下文。

### Stone 与 Flow 的写入隔离

Flow 只能写自己的目录。Flow 不能直接修改：
- 自己的 Stone 的 self.md / data.json / knowledge/ / server/
- 其他对象的任何文件
- 其他 Session 的任何文件

想沉淀到 Stone（修改身份/记忆/knowledge），必须通过 super 分身的 SuperFlow 通道
（详见 reflectable/super-flow）；想影响其他对象，必须通过 talk。

这个约束让并发 Flow 不会互相踩踏。

### Flow 的"合并视图"

一次思考时，Object 看到的不是孤立的 Stone 或 Flow，而是两者**合并视图**：
- self.md 来自 Stone（身份不变）
- knowledge 来自 Stone + Flow 同名覆盖（Flow 级 knowledge 优先）
- server / client 同理（Flow 可临时覆盖 Stone 同名实现）
- threads / data.json 仅来自 Flow

合并规则统一：**同名时 Flow 覆盖 Stone**，让 Flow 拥有 session 级的临时变更能力。

## Session — 多 Flow 协作的工作空间

一次端到端的任务处理 = 一个 Session。
从用户发起一个请求开始，到该请求被完成或放弃结束。

### Session 不是一个类

工程实现上，**Session 不是运行时对象，只是"一个目录 + 一个 sessionId"**。
所有 session 级状态都直接体现为 \`flows/{sessionId}/\` 下的文件。

### 目录结构

\`\`\`
flows/{sessionId}/
├── .session.json              Session 元数据（id / title / startedAt / status / rootObject）
├── readme.md                  Session 工作状态摘要（由 supervisor 维护）
│
├── user/                      用户视角的 Flow（user inbox 等用户侧状态）
│   └── data.json              含 inbox（threadId, messageId 列表）
│
├── objects/                   参与对象的 Flow 目录（按 stone 名）
│   ├── {nameA}/               Stone A 在本 session 的 Flow
│   │   └── （结构同 stone，无 self.md，多 threads/）
│   ├── {nameB}/
│   └── ...
│
├── issues/                    Session 级 Issue 跟踪（看板，跨对象共享）
│   ├── index.json
│   └── issue-{id}.json
│
└── tasks/                     Session 级 Task 跟踪
    ├── index.json
    └── task-{id}.json
\`\`\`

### 层次关系

\`\`\`
Session (flows/{sid}/)
  ├── Flow (objects/A/)
  │   ├── Thread 1 (根线程)
  │   │   └── Thread 2 (子线程)
  │   └── Thread 3 (另一根)
  └── Flow (objects/B/)
      └── Thread 4
\`\`\`

| 概念 | 粒度 | 归属 |
|---|---|---|
| Session | 一次任务（一个目录） | 多对象共享 |
| Flow    | 单对象在单个 Session 中的状态 | 单对象 |
| Thread  | 单 Flow 中的单个执行线程 | 单 Flow |

### Session 的生命周期

1. **创建** — 用户发起消息（或系统触发），创建 \`flows/{sid}/\` 目录与 \`.session.json\`
2. **运行** — 各参与对象的 Flow 在 \`objects/\` 下并发运行
3. **协作** — 通过 talk / Issue / Task 机制跨对象协作
4. **结束** — 根任务完成或用户终止；目录保留（不删），但 \`.flow.json\` 标记被清除，不再加载

### 跨对象协作的 Session 语义

当对象 A 通过 \`talk(target=B, ...)\` 向对象 B 发消息：

1. 消息被投递到 \`flows/{sid}/objects/B/\` 的某个线程 inbox
2. 如果 B 的 Flow 不存在，**自动创建**（在同一个 Session 下）
3. B 的 Flow 处理消息，可能再 talk 给其他对象
4. 所有交互都发生在**同一个 Session 的 objects/ 下**

保证：
- 跨对象的线程树可以追溯到同一个 Session
- 看板（Issue/Task）跨对象共享
- Session 结束时所有参与对象统一清理

### Session readme.md

由 supervisor 维护，描述"这个 Session 正在做什么、进展如何"。
前端在 Session 列表中直接展示这段摘要，让用户快速判断每个 session 的当前状态。
`,
};

