import { object_v20260504_1 } from "@meta/object/index.doc";
import * as persistable from "@src/persistable/index";

export const persistable_v20260504_1 = {
  get parent() { return object_v20260504_1; },
  sources: {
    persistable,
  },
  index: `
Persistable 描述 Object 如何在文件系统中存在。

OOC 的核心断言：**对象的持久化目录就是它的物理存在**。
- 目录存在 → 对象存在
- 目录被删除 → 对象消亡
- 目录被复制/迁移 → 对象搬家
- 修改目录里的文件 → 对象自身的属性/能力立即改变

为什么是文件系统而不是数据库？
- 可读：人类能直接打开、查看、备份
- 可写：对象可以修改自己的身份、数据、能力
- 可引用：路径即地址，可被其他对象（或 LLM）引用
- 可归档：目录能复制、删除、迁移

Object 存在的两个基本形态:
- stone
    - 静态形态 / 持久态
    - 表示这个 Object 的长期身份、数据、knowledge、memory
- flow
    - 动态形态 / 任务执行态
    - 表示这个 Object 在某个 session 的运行过程

stone 持久化的核心文件:
/stones/{objectId}/
- .stone.json
    配置文件 & 标识这是一个 stone 目录
- self.md
    对象身份与自我说明
- readme.md
    对外介绍
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
- threads/{threadId}/debug/llm.input.json
    debug 数据，默认要产出，构造的 context, 每次请求 LLM 前写入该文件, 相关设计可以见 observable 文档
- threads/{threadId}/debug/llm.output.json
    debug 数据，默认要产出，LLM 输出内容
- threads/{threadId}/debug/loop_0001.input.json
    debug 数据，第一轮的 context；开启 debug 模式后按固定 4 位 zero-pad 文件名记录每一轮的 input / output / meta

## 当前实现阶段

当前实现覆盖：

**Stone（对象身份/数据）持久化**
- \`stones/{objectId}/.stone.json\` — metadata
- \`stones/{objectId}/self.md\` — 身份说明（读写）
- \`stones/{objectId}/readme.md\` — 对外说明（读写）
- \`stones/{objectId}/data.json\` — 属性数据（读写 + 顶层 merge）
- \`stones/{objectId}/server/index.ts\` — server 方法源码（读写）
- 其余目录（knowledge / memory / relations / client / files）仅建骨架，不读不写

**Flow（对象运行态）持久化**
- 初始化 \`flows/{sessionId}/objects/{objectId}/\`
- 读写 \`threads/{threadId}/thread.json\`
- 写入 \`threads/{threadId}/debug/llm.input.json\`
- 写入 \`threads/{threadId}/debug/llm.output.json\`

本阶段不实现 stone/flow 数据合并、多 object session 协作、跨 object talk 投递。

## Session — 多 Flow 协作的工作空间

一次端到端的任务处理 = 一个 Session。
从用户发起一个请求开始，到该请求被完成或放弃结束。

### 目录结构

\`\`\`
flows/{sessionId}/
├── .session.json              Session 元数据（id / title / startedAt / status / rootObject）
├── readme.md                  Session 工作状态摘要（由 supervisor 维护）
│
├── objects/                   参与对象的 Flow 目录（按 stone 名）
│   ├── user/                      对应系统用户的 Flow 对象目录
│   │   └── data.json              记录 session 下，user 交互的 messages
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
`,
};
