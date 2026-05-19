import type { Concept, DocNode } from "@meta/doc-types";
import { collaborable_v20260504_1 } from "@meta/object/collaborable/index.doc";
import {
  issue_v20260506_1,
  type IssueConcept,
} from "@meta/object/collaborable/kanban/issue.doc";
import {
  task_v20260506_1,
  type TaskConcept,
} from "@meta/object/collaborable/kanban/task.doc";
import {
  comment_v20260506_1,
  type CommentConcept,
} from "@meta/object/collaborable/kanban/comment.doc";
import {
  concurrent_write_v20260506_1,
  type ConcurrentWriteConcept,
} from "@meta/object/collaborable/kanban/concurrent-write.doc";
import * as flowObject from "@src/persistable/flow-object";
import * as issuePersistence from "@src/persistable/issue";
import * as issueService from "@src/persistable/issue-service";
import * as serialQueue from "@src/persistable/serial-queue";
import * as mention from "@src/persistable/mention";
import * as issuesHttp from "@src/app/server/modules/issues";
import * as issueWindowReg from "@src/executable/windows/issue";
import * as createIssueCmd from "@src/executable/windows/root/create-issue";
import * as openIssueCmd from "@src/executable/windows/root/open-issue";

/* ────────────────────────────────────────────────────────────────
 *  目录页：Kanban 概念全貌
 * ──────────────────────────────────────────────────────────────── */

/**
 * Kanban 概念：Session 级的结构化协作机制。
 *
 * sources（看板数据落在 flow 目录下 + Issue 子树的完整实现 stack）:
 *  - flowObject       — flows/{sid}/objects/{id}/ 目录骨架,承载 issues/ 与 tasks/ 子树
 *  - issuePersistence — flows/{sid}/issues/issue-{id}.json + index.json 类型与 IO(U1)
 *  - issueService     — Tier A 业务逻辑(create/comment/close)+ SerialQueue + 订阅扫描(U2)
 *  - serialQueue      — per-key Promise chain,HTTP 与 worker 共用(U2)
 *  - mention          — 文本 @ 解析正则(U2)
 *  - issuesHttp       — Tier A 5 个 HTTP endpoint(U3)
 *  - issueWindowReg   — Tier B issue_window 注册 + comment command(U6)
 *  - createIssueCmd / openIssueCmd — Tier B root 命令(U5)
 *
 * implementation status (2026-05-19): Tier A 持久化 + HTTP + Tier B IssueWindow
 * + 双轨 mention(structured + 正则) + pull-on-tick 兜底已落地;详见
 * docs/plans/2026-05-19-001-feat-issue-context-window-plan.md。
 */
export type KanbanConcept = Concept & {
  sources: {
    flowObject: typeof flowObject;
    issuePersistence: typeof issuePersistence;
    issueService: typeof issueService;
    serialQueue: typeof serialQueue;
    mention: typeof mention;
    issuesHttp: typeof issuesHttp;
    issueWindowReg: typeof issueWindowReg;
    createIssueCmd: typeof createIssueCmd;
    openIssueCmd: typeof openIssueCmd;
  };

  /** Issue / Task 数据结构与多对多关系 */
  coreConcepts: DocNode;

  /** flows/{sid}/ 下的持久化位置（双写设计 + Session 级目录） */
  persistence: {
    title: string;
    summary?: string;
    layout: DocNode;
    dualWriteRationale: DocNode;
    sessionLevelLocation: DocNode;
  };

  /** 写入方：supervisor / 其他 Object / user */
  writers: {
    title: string;
    summary?: string;
    supervisorWriter: DocNode;
    objectWriter: DocNode;
    userWriter: DocNode;
  };

  /** hasNewInfo 红点机制 */
  hasNewInfoMechanism: {
    title: string;
    summary?: string;
    setToTrue: DocNode;
    ackAutoReset: DocNode;
    signalNoiseBalance: DocNode;
  };

  /** reportPages 机制 */
  reportPagesMechanism: DocNode;

  /** Session 级、不跨 Session */
  sessionScope: DocNode;

  /** kanban 与 talk 的边界 */
  vsTalk: {
    title: string;
    summary?: string;
    scenarioTable: DocNode;
    heuristics: DocNode;
  };

  /** 子概念集合（被 walker 识别） */
  concepts: {
    issue: IssueConcept;
    task: TaskConcept;
    comment: CommentConcept;
    concurrentWrite: ConcurrentWriteConcept;
  };
};

/* ────────────────────────────────────────────────────────────────
 *  数据填充
 * ──────────────────────────────────────────────────────────────── */

export const kanban_v20260506_1: KanbanConcept = {
  name: "Kanban",
  get parent() {
    return collaborable_v20260504_1;
  },
  sources: {
    flowObject,
    issuePersistence,
    issueService,
    serialQueue,
    mention,
    issuesHttp,
    issueWindowReg,
    createIssueCmd,
    openIssueCmd,
  },
  description: `
Kanban 是 Session 级的结构化、多方可见的协作机制。

talk 是点对点；kanban 提供多方可见的结构化容器。当一个话题需要多轮讨论、
多人参与、长期跟踪时，单纯的 talk 不够，需要 Issue + Task。
`.trim(),

  coreConcepts: {
    title: "核心概念",
    summary: "Issue / Task 多对多——一个 Issue 可拆多 Task，一个 Task 可解多 Issue",
    content: `
\`\`\`
Issue（需求 / 问题讨论）       Task（执行单元）
  ├── id                      ├── id
  ├── title                   ├── title
  ├── status                  ├── status
  ├── description             ├── description
  ├── participants            ├── issueRefs（多对多关联 Issue）
  ├── taskRefs（多对多关联 Task）├── subtasks[]
  ├── comments[]              └── reportPages[]
  └── reportPages[]
\`\`\`
    `.trim(),
  },

  persistence: {
    title: "持久化位置",
    summary: "flows/{sid}/ 下双写：index.json + 单条文件",

    layout: {
      title: "目录布局",
      content: `
\`\`\`
flows/{sessionId}/
├── issues/
│   ├── index.json              全量 Issue 列表（前端可一次性读取）
│   └── issue-{id}.json         单条 Issue 完整数据（按 id 拉取详情）
└── tasks/
    ├── index.json              全量 Task 列表
    └── task-{id}.json          单条 Task 完整数据
\`\`\`
      `.trim(),
    },

    dualWriteRationale: {
      title: "双写：index + 单条",
      content: `
每条 Issue/Task 同时存在于 \`index.json\` 和单条文件——便于前端两种访问模式：
列表页一次读 index，详情页只读单条。两者的同步由 SerialQueue 保护
（详见 concepts.concurrentWrite.indexSync）。
      `.trim(),
    },

    sessionLevelLocation: {
      title: "Session 级目录、非 Object 级",
      content: `
kanban 数据落在 \`flows/{sid}/\` 顶层（\`issues/\` 与 \`tasks/\`），不在
\`objects/{id}/\` 之下——因为 Issue/Task 跨 Object 共享，不属于任何单一 Object Flow。
      `.trim(),
    },
  },

  writers: {
    title: "谁能写",
    summary: "supervisor / 其他 Object / user 三类写入方与各自能力面",

    supervisorWriter: {
      title: "supervisor",
      content: `
拥有 session-kanban 专属 knowledge + server 模块，可创建 / 改状态 /
改结构。详见 collaborable.concepts.supervisor。
      `.trim(),
    },

    objectWriter: {
      title: "其他 Object",
      content: `
通过 talkable 下 issue-discussion 相关 knowledge **仅能评论 / 讨论**，
不能改 Issue / Task 结构与状态。
      `.trim(),
    },

    userWriter: {
      title: "user",
      content: `
通过后端 HTTP API 直接写。常见入口如 \`POST /api/sessions/{sid}/issues/{id}/comments\`、\`/ack\` 等。
      `.trim(),
    },
  },

  hasNewInfoMechanism: {
    title: "hasNewInfo 机制",
    summary: "Issue / Task 共用的红点提示机制，ack 自动清零",

    setToTrue: {
      title: "设为 true 的时机",
      content: `
当有需要人类确认的新信息时（方案初稿 / 关键决策 / 完成态等），设为 true。
前端 UI 显示红点提示。
      `.trim(),
    },

    ackAutoReset: {
      title: "ack 自动清零",
      content: `
人类打开详情页时自动 reset：

- \`POST /api/sessions/{sid}/issues/{id}/ack\` → 自动 \`setIssueNewInfo(false)\`
- \`POST /api/sessions/{sid}/tasks/{id}/ack\` → 自动 \`setTaskNewInfo(false)\`

ack 与"打开详情页"绑定，不需要单独点击"已读"按钮。
      `.trim(),
    },

    signalNoiseBalance: {
      title: "信噪比设计",
      content: `
目标：让用户不错过关键进展，但也不被所有更新淹没。Object 自己判断"这条
更新需要人类确认吗"，决定是否设 hasNewInfo——避免每次写入都打扰用户。
      `.trim(),
    },
  },

  reportPagesMechanism: {
    title: "reportPages 机制",
    summary: "Issue / Task 可关联 Object 自渲染的 client 页面",
    content: `
\`\`\`
Task task-001:
  reportPages: [
    "flows/{sid}/objects/alan/client/pages/task-001-result"
  ]
\`\`\`

由负责该 Task 的 Object 在自己的 Flow 目录下生成 \`client/pages/{name}.tsx\`，
再通过 updateTask 关联到 Task。前端 Task 详情页的 Reports tab 用动态加载渲染该页。
详见 executable/client。
    `.trim(),
  },

  sessionScope: {
    title: "Session 级、不跨 Session",
    summary: "kanban 数据归属 Session，不同 Session 完全独立",
    content: `
kanban 数据归属 Session（路径 \`flows/{sid}/issues|tasks/\`）。
不同 Session 的 kanban 完全独立。

Session 结束后看板数据保留在磁盘，但不再被加载——对应的 Object Flow 都不再活跃。
    `.trim(),
  },

  vsTalk: {
    title: "与 talk 的边界",
    summary: "talk 点对点；kanban 结构化容器——多方持续协作",

    scenarioTable: {
      title: "场景对照表",
      content: `
| 场景 | 用 talk | 用 kanban |
|---|---|---|
| 一对一信息传递 | ✓ | ✗ |
| 多人多轮讨论 | 多发几轮 talk 也行，但难追溯 | ✓ Issue + comments |
| 跟踪执行进度 | ✗ | ✓ Task + subtasks |
| 跨对象协调 | 临时协调 | 结构化协调（多 Object 跨多任务） |
| 让用户看见全貌 | 需要 Object 主动汇报 | 直接前端可视化 |
      `.trim(),
    },

    heuristics: {
      title: "经验规则",
      content: `
- 临时一两轮交互 → talk
- 需要多方持续关注 + 状态机推进 → kanban
- 二者经常并用：kanban 提供结构骨架，talk 在每个节点细化沟通
      `.trim(),
    },
  },

  concepts: {
    issue: issue_v20260506_1,
    task: task_v20260506_1,
    comment: comment_v20260506_1,
    concurrentWrite: concurrent_write_v20260506_1,
  },
};
