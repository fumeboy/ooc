import { object_v20260504_1 } from "@meta/object/index.doc";
import * as persistableIndex from "@src/persistable/index";
import * as persistableCommon from "@src/persistable/common";
import * as stoneObject from "@src/persistable/stone-object";
import * as stoneData from "@src/persistable/stone-data";
import * as stoneSelf from "@src/persistable/stone-self";
import * as stoneReadme from "@src/persistable/stone-readme";
import * as stoneServer from "@src/persistable/stone-server";
import * as flowObject from "@src/persistable/flow-object";
import * as threadJson from "@src/persistable/thread-json";
import * as debugFile from "@src/persistable/debug-file";

/**
 * Persistable 概念：Object 在文件系统中的完整持久化表达。
 *
 * sources（覆盖 src/persistable/ 全部主干文件）:
 *  - persistableIndex   — re-export 入口
 *  - persistableCommon  — 共享 path helper / FlowObjectRef / StoneObjectRef
 *  - stoneObject        — stones/{id}/ 目录骨架与 .stone.json
 *  - stoneData          — data.json 读写 + merge
 *  - stoneSelf          — self.md 读写
 *  - stoneReadme        — readme.md 读写
 *  - stoneServer        — stones/{id}/server/ 源码读写
 *  - flowObject         — flows/{sid}/objects/{id}/ 目录骨架与 .flow.json
 *  - threadJson         — threads/{tid}/thread.json 读写 + 反序列化兜底
 *  - debugFile          — debug/llm.input/output.json + loop_NNNN.* 落盘
 */
export const persistable_v20260504_1 = {
  name: "Persistable",
  get parent() { return object_v20260504_1; },
  sources: {
    persistableIndex,
    persistableCommon,
    stoneObject,
    stoneData,
    stoneSelf,
    stoneReadme,
    stoneServer,
    flowObject,
    threadJson,
    debugFile,
  },
  description: `
Persistable 描述 Object 如何在文件系统中存在。

OOC 的核心断言：**对象的持久化目录就是它的物理存在**。

- 目录存在 → 对象存在
- 目录被删除 → 对象消亡
- 目录被复制 / 迁移 → 对象搬家
- 修改目录里的文件 → 对象自身的属性 / 能力立即改变

按子字段展开：

- whyFilesystem — 为何选文件系统作为持久层
- forms — Object 的两种形态（Stone / Flow）
- stoneLayout — stones/{objectId}/ 目录骨架与各文件语义
- flowLayout — flows/{sid}/objects/{id}/ 目录骨架与 thread 层
- debugLayout — debug 目录下 llm.input/output.json + loop_NNNN.* 的形态
- session — 多 Flow 协作的工作空间
- hierarchy — Session / Flow / Thread 三层概念粒度与归属
`.trim(),

  whyFilesystem_v20260504_1: {
    index: `
## 为何文件系统而不是数据库

- **可读**：人类能直接打开、查看、备份
- **可写**：对象可以修改自己的身份、数据、能力
- **可引用**：路径即地址，可被其他对象（或 LLM）引用
- **可归档**：目录能复制、删除、迁移
`.trim(),
  },

  forms_v20260504_1: {
    index: `
## Object 的两种形态

| 形态 | 含义 | 路径 |
|---|---|---|
| Stone | 静态形态 / 持久态：长期身份、数据、knowledge、memory | \`stones/{objectId}/\` |
| Flow | 动态形态 / 任务执行态：在某个 session 的运行过程 | \`flows/{sid}/objects/{objectId}/\` |

同一对象的 Stone + 当前 session 的 Flow 共同组合为该 session 下的对象视图。
`.trim(),
  },

  stoneLayout_v20260504_1: {
    index: `
## stones/{objectId}/ 目录骨架

\`\`\`
stones/{objectId}/
├── .stone.json              配置 & 标识这是一个 stone 目录
├── self.md                  对象身份与自我说明（→ identity.innerSelf）
├── readme.md                对外介绍（→ identity.outerReadme）
├── data.json                Object 的属性与数据（顶层 merge 语义）
├── knowledge/               知识库根
│   ├── .knowledge.json      knowledge 配置（含外部引用映射）
│   ├── {dirName}/           多级子目录组织（无特别含义）
│   ├── **/*.md              知识文档（yaml frontmatter）
│   ├── memory/              跨任务保留的记忆
│   │   └── index.md         记忆索引页 + 最近记忆
│   └── relations/
│       └── {objectId}.md    和其他 Object 的关系文档
├── server/                  Object 的方法程序
│   └── index.ts             路由注册层（声明哪些函数 LLM 可见 / 前端可访问）
├── client/                  React UI 页面
│   └── index.tsx
├── files/                   其他文件
└── super/                   super 分身的 flow 通道（详见 reflectable）
\`\`\`

源码绑定见 sources 各 stone-* module。
`.trim(),
  },

  flowLayout_v20260504_1: {
    index: `
## flows/{sessionId}/objects/{objectId}/ 目录骨架

\`\`\`
flows/{sessionId}/objects/{objectId}/
├── .flow.json               配置 & 标识这是一个 flow object 目录
├── ... 除了无 self.md，复用与 stone 一致的目录结构
└── threads/
    └── {threadId}/
        ├── thread.json      线程数据（详见 threadJson source）
        └── debug/           debug 输出（详见 debugLayout 子节点）
\`\`\`

flow object 自身没有 self.md（identity 来自 Stone 层）。其它子目录
（data.json / knowledge / server / client / files）与 Stone 同构，承载 session
内可变化的运行态数据。

源码：\`flowObject\` source（目录骨架）+ \`threadJson\` source（thread.json 读写）。
`.trim(),
  },

  debugLayout_v20260504_1: {
    index: `
## debug/ 目录形态

\`\`\`
threads/{threadId}/debug/
├── llm.input.json           最近一次请求 LLM 前的完整 inputItems + contextSnapshot
├── llm.output.json          最近一次 LLM 输出
└── loop_NNNN.{input,output,meta}.json
                             开启 debug 模式后按 4 位 zero-pad 文件名记录每一轮的
                             input / output / meta
\`\`\`

llm.input.json schema 见 \`@src/persistable/debug-file\` 的 \`LlmInputDebugRecord\`
type；contextSnapshot 与 inputItems 中 system message 的 XML 同源。

debug 开关与控制平面详见 \`observable.debug\`。
`.trim(),
  },

  session_v20260504_1: {
    index: `
## Session — 多 Flow 协作的工作空间

一次端到端的任务处理 = 一个 Session。从用户发起请求开始，到请求被完成或放弃结束。

\`\`\`
flows/{sessionId}/
├── .session.json              Session 元数据（id / title / startedAt / status / rootObject）
├── readme.md                  Session 工作状态摘要（由 supervisor 维护）
│
├── objects/                   参与对象的 Flow 目录（按 stone 名）
│   ├── user/                      系统用户对应的 Flow 对象目录
│   │   └── ...                    user.root thread 持有 talk_window 派送消息
│   ├── {nameA}/               Stone A 在本 session 的 Flow
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

issues / tasks 形态详见 \`collaborable.kanban\`。
`.trim(),
  },

  hierarchy_v20260504_1: {
    index: `
## Session / Flow / Thread 层次关系

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

Thread 自己的运行时结构详见 \`thinkable.thread\`。
`.trim(),
  },
};
