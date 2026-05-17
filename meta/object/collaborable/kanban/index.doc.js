import * as flowObject from "@src/persistable/flow-object";
import { collaborable_v20260504_1 } from "@meta/object/collaborable/index.doc";
import { issue_v20260506_1 } from "@meta/object/collaborable/kanban/issue.doc";
import { task_v20260506_1 } from "@meta/object/collaborable/kanban/task.doc";
import { comment_v20260506_1 } from "@meta/object/collaborable/kanban/comment.doc";
import { concurrent_write_v20260506_1 } from "@meta/object/collaborable/kanban/concurrent-write.doc";

/**
 * Kanban 概念：Session 级的结构化协作机制。
 *
 * sources（看板数据落在 flow 目录下，是 flow object 持久化层之上的语义层）:
 *  - flowObject — flows/{sid}/objects/{id}/ 目录骨架，承载 issues/ 与 tasks/ 子树
 */
export const kanban_v20260506_1 = {
  name: "Kanban",
  get parent() { return collaborable_v20260504_1; },
  sources: {
    flowObject,
  },
  description: `
Kanban 是 Session 级的结构化、多方可见的协作机制。

talk 是点对点；kanban 提供多方可见的结构化容器。当一个话题需要多轮讨论、
多人参与、长期跟踪时，单纯的 talk 不够，需要 Issue + Task。

按子字段展开（见各子字段）：

- coreConcepts — Issue / Task 数据结构与多对多关系
- persistence — flows/{sid}/ 下的持久化位置
- writers — 谁能写、写入的能力面
- hasNewInfoMechanism — 红点提示的统一机制
- reportPagesMechanism — 关联 Object 自渲染页的机制
- sessionScope — Session 级、不跨 Session
- vsTalk — kanban 与 talk 的边界
- concepts — 子概念集合（issue / task / comment / concurrentWrite）
`,

  coreConcepts_v20260517_1: {
    title: "核心概念",
    content: `

Issue（需求 / 问题讨论）       Task（执行单元）
  ├── id                      ├── id
  ├── title                   ├── title
  ├── status                  ├── status
  ├── description             ├── description
  ├── participants            ├── issueRefs（多对多关联 Issue）
  ├── taskRefs（多对多关联 Task）├── subtasks[]
  ├── comments[]              └── reportPages[]
  └── reportPages[]


Issue 和 Task 多对多——一个 Issue 可拆成多个 Task，一个 Task 可解决多个 Issue。
    `,
  },

  persistence_v20260517_1: {
    title: "持久化位置",
    content: `

flows/{sessionId}/
├── issues/
│   ├── index.json              全量 Issue 列表（前端可一次性读取）
│   └── issue-{id}.json         单条 Issue 完整数据（按 id 拉取详情）
└── tasks/
    ├── index.json              全量 Task 列表
    └── task-{id}.json          单条 Task 完整数据


详见两个子节点：双写冗余设计 + 与单 Object Flow 的边界。
    `,

    dualWriteRationale_v20260517_1: {
      title: "双写：index + 单条",
      content: `
每条 Issue/Task 同时存在于 index.json 和单条文件——便于前端两种访问模式：
列表页一次读 index，详情页只读单条。两者的同步由 SerialQueue 保护
（详见 collaborable.kanban.concurrentWrite.indexSync）。
      `,
    },

    sessionLevelLocation_v20260517_1: {
      title: "Session 级目录、非 Object 级",
      content: `
kanban 数据落在 flows/{sid}/ 顶层（issues/ 与 tasks/），不在 objects/{id}/
之下——因为 Issue/Task 跨 Object 共享，不属于任何单一 Object Flow。
      `,
    },
  },

  writers_v20260517_1: {
    title: "谁能写",
    content: `
三类写入方各自的入口与能力面见子节点。
三方写入需通过串行化队列保护，详见 collaborable.kanban.concurrentWrite。
    `,

    supervisorWriter_v20260517_1: {
      title: "supervisor",
      content: `
拥有 session-kanban 专属 knowledge + server 模块，可创建 / 改状态 /
改结构。详见 collaborable.supervisor。
      `,
    },

    objectWriter_v20260517_1: {
      title: "其他 Object",
      content: `
通过 talkable 下 issue-discussion 相关 knowledge 仅能评论 / 讨论，
不能改 Issue / Task 结构与状态。
      `,
    },

    userWriter_v20260517_1: {
      title: "user",
      content: `
通过后端 HTTP API 直接写。常见入口如
POST /api/sessions/{sid}/issues/{id}/comments、/ack 等。
      `,
    },
  },

  hasNewInfoMechanism_v20260517_1: {
    title: "hasNewInfo 机制",
    content: `
每个 Issue / Task 有 hasNewInfo 布尔字段。详见三个子节点：触发、自动清零、设计意图。
    `,

    setToTrue_v20260517_1: {
      title: "设为 true 的时机",
      content: `
当有需要人类确认的新信息时（方案初稿 / 关键决策 / 完成态等），设为 true。
前端 UI 显示红点提示。
      `,
    },

    ackAutoReset_v20260517_1: {
      title: "ack 自动清零",
      content: `
人类打开详情页时自动 reset：

- POST /api/sessions/{sid}/issues/{id}/ack → 自动 setIssueNewInfo(false)
- POST /api/sessions/{sid}/tasks/{id}/ack  → 自动 setTaskNewInfo(false)

ack 与"打开详情页"绑定，不需要单独点击"已读"按钮。
      `,
    },

    signalNoiseBalance_v20260517_1: {
      title: "信噪比设计",
      content: `
目标：让用户不错过关键进展，但也不被所有更新淹没。Object 自己判断"这条
更新需要人类确认吗"，决定是否设 hasNewInfo——避免每次写入都打扰用户。
      `,
    },
  },

  reportPagesMechanism_v20260517_1: {
    title: "reportPages 机制",
    content: `
Issue 和 Task 可关联一个或多个 report 页面（Object 自渲染 client）：


Task task-001:
  reportPages: [
    "flows/{sid}/objects/alan/client/pages/task-001-result"
  ]


由负责该 Task 的 Object 在自己的 Flow 目录下生成 client/pages/{name}.tsx，
再通过 updateTask 关联到 Task。前端 Task 详情页的 Reports tab 用动态加载渲染该页。

详见 executable/client。
    `,
  },

  sessionScope_v20260517_1: {
    title: "Session 级、不跨 Session",
    content: `
kanban 数据归属 Session（路径 flows/{sid}/issues|tasks/）。
不同 Session 的 kanban 完全独立。

Session 结束后看板数据保留在磁盘，但不再被加载——
对应的 Object Flow 都不再活跃。
    `,
  },

  vsTalk_v20260517_1: {
    title: "与 talk 的边界",
    content: `
详见两个子节点：场景对照表与经验规则。
    `,

    scenarioTable_v20260517_1: {
      title: "场景对照表",
      content: `
| 场景 | 用 talk | 用 kanban |
|---|---|---|
| 一对一信息传递 | ✓ | ✗ |
| 多人多轮讨论 | 多发几轮 talk 也行，但难追溯 | ✓ Issue + comments |
| 跟踪执行进度 | ✗ | ✓ Task + subtasks |
| 跨对象协调 | 临时协调 | 结构化协调（多 Object 跨多任务）|
| 让用户看见全貌 | 需要 Object 主动汇报 | 直接前端可视化 |
      `,
    },

    heuristics_v20260517_1: {
      title: "经验规则",
      content: `
- 临时一两轮交互 → talk
- 需要多方持续关注 + 状态机推进 → kanban
- 二者经常并用：kanban 提供结构骨架，talk 在每个节点细化沟通
      `,
    },
  },

  concepts: {
    issue: issue_v20260506_1,
    task: task_v20260506_1,
    comment: comment_v20260506_1,
    concurrentWrite: concurrent_write_v20260506_1,
  },
};
