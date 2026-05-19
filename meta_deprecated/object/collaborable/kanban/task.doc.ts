import type { Concept, DocNode } from "@meta/doc-types";
import { kanban_v20260506_1 } from "@meta/object/collaborable/kanban/index.doc";
import * as flowObject from "@src/persistable/flow-object";

/* ────────────────────────────────────────────────────────────────
 *  目录页：Task 概念全貌
 * ──────────────────────────────────────────────────────────────── */

/**
 * Task 概念：Session 级的执行单元，多对多关联 Issue。
 *
 * sources（task 数据落在 flow 目录的 tasks 子树中）:
 *  - flowObject — flows/{sid}/objects/{id}/ 目录骨架，承载 tasks/ 子树
 */
export type TaskConcept = Concept & {
  sources: { flowObject: typeof flowObject };

  /** 数据结构：Task 主体 + SubTask */
  shape: {
    title: string;
    summary?: string;
    taskFields: DocNode;
    subtaskFields: DocNode;
  };

  /** 状态流转：三态枚举 + 与 Issue 的简化对比 */
  statusFlow: {
    title: string;
    summary?: string;
    threeStateEnum: DocNode;
    simplerThanIssue: DocNode;
  };

  /** SubTask：示例 / 边界 / assignee 通知 */
  subtasks: {
    title: string;
    summary?: string;
    example: DocNode;
    boundary: DocNode;
    assigneeNotification: DocNode;
  };

  /** 与 Issue 双向关联 */
  issueRefs: DocNode;

  /** hasNewInfo 红点提示 */
  hasNewInfo: {
    title: string;
    summary?: string;
    triggers: DocNode;
    ackPath: DocNode;
  };

  /** 关联 Object 自渲染页 */
  reportPages: DocNode;

  /** 典型 server 方法集：Task 方法 + SubTask 方法 */
  operations: {
    title: string;
    summary?: string;
    taskMethods: DocNode;
    subtaskMethods: DocNode;
  };

  /** Task 与 Issue 的选择经验 */
  vsIssue: DocNode;
};

/* ────────────────────────────────────────────────────────────────
 *  数据填充
 * ──────────────────────────────────────────────────────────────── */

export const task_v20260506_1: TaskConcept = {
  name: "Task",
  get parent() {
    return kanban_v20260506_1;
  },
  sources: { flowObject },
  description: `
Task 是 Session 级的执行单元，多对多关联 Issue。
`.trim(),

  shape: {
    title: "数据结构",
    summary: "主体 Task + 内嵌 SubTask 列表",

    taskFields: {
      title: "Task 主体字段",
      content: `
\`\`\`typescript
interface Task {
  id: string;                       // "task-001"
  title: string;
  status: TaskStatus;               // running | done | closed
  description?: string;             // markdown
  issueRefs: string[];              // 关联的 Issue id
  reportPages: string[];            // 关联的 report client 页路径
  subtasks: SubTask[];              // 子任务列表
  hasNewInfo: boolean;
  createdAt: string;
  updatedAt: string;
}
\`\`\`
      `.trim(),
    },

    subtaskFields: {
      title: "SubTask 字段",
      content: `
\`\`\`typescript
interface SubTask {
  id: string;                       // "sub-001"（在所属 Task 内自增）
  title: string;
  assignee?: string;                // 负责的 Object 名
  status: "pending" | "running" | "done";
}
\`\`\`
      `.trim(),
    },
  },

  statusFlow: {
    title: "状态",
    summary: "running → done → closed 三态枚举",

    threeStateEnum: {
      title: "三态枚举",
      content: `
\`\`\`
running  → done  → closed
\`\`\`

- \`running\`：执行中
- \`done\`：完成
- \`closed\`：归档（含放弃）
      `.trim(),
    },

    simplerThanIssue: {
      title: "为什么比 Issue 简单",
      content: `
Task 是执行单元，要么在做、要么做完、要么归档；没有"讨论"/"设计"/"评审"
等讨论阶段（那些在 Issue 中体现）。这种简化反映了"Issue 是讨论容器、
Task 是执行容器"的边界。
      `.trim(),
    },
  },

  subtasks: {
    title: "SubTask",
    summary: "Task 可有 SubTask 列表，是 Task 的分步而非独立 Task",

    example: {
      title: "示例",
      content: `
\`\`\`json
{
  "subtasks": [
    { "id": "sub-001", "title": "设计数据结构", "assignee": "alan",  "status": "done" },
    { "id": "sub-002", "title": "实现 API",     "assignee": "coder", "status": "running" },
    { "id": "sub-003", "title": "写测试",       "assignee": "coder", "status": "pending" }
  ]
}
\`\`\`
      `.trim(),
    },

    boundary: {
      title: "SubTask 与 Task 的边界",
      content: `
- SubTask 不是独立的 Task——它是 Task 的"分步"
- 轻量结构，不支持独立评论或 reportPages
- SubTask id 在所属 Task 内自增（不跨 Task 唯一）
      `.trim(),
    },

    assigneeNotification: {
      title: "自动通知 assignee",
      content: `
某 Object 被分配到 SubTask 时，系统通知该 Object：

\`\`\`
Alan 被分配 sub-001：
  → Alan 的 inbox 收到 [new] 你被分配到 task-001 的子任务 sub-001：实现 wait 唤醒逻辑
\`\`\`

Object 开始处理后，可主动 \`updateSubTask\` 把 status 改为 running，完成后改为 done。
      `.trim(),
    },
  },

  issueRefs: {
    title: "issueRefs（多对多）",
    summary: "与 Issue 双向关联，新增 / 修改时两侧都要更新",
    content: "详见 kanban.concepts.issue.taskRefs（refs.issue）。",
  },

  hasNewInfo: {
    title: "hasNewInfo",
    summary: "与 Issue 同：有需要人类确认的新信息时设为 true，前端显示红点",

    triggers: {
      title: "典型触发",
      content: `
- Task 完成需要人工验收
- 执行中遇到阻碍需要决策
- subtasks 全部完成等关键里程碑
      `.trim(),
    },

    ackPath: {
      title: "清零路径",
      content: `
人类打开详情页 → \`POST /api/sessions/{sid}/tasks/{id}/ack\` → 自动调用
\`setTaskNewInfo(id, false)\` 把红点清零。
      `.trim(),
    },
  },

  reportPages: {
    title: "reportPages",
    summary: "Task 完成后的结果展示页面",
    content: `
由负责 Object 在自己的 Flow 目录下生成 \`client/pages/{name}.tsx\`，再通过
\`updateTask\` 关联：

\`\`\`json
{
  "reportPages": [
    "flows/{sid}/objects/alan/client/pages/task-001-report"
  ]
}
\`\`\`

详见 executable/client。
    `.trim(),
  },

  operations: {
    title: "典型操作",
    summary: "supervisor 通过 server 方法操作；按 Task / SubTask 分组",

    taskMethods: {
      title: "Task 方法",
      content: `
- \`createTask(sessionDir, title, description?, issueRefs?)\`
- \`updateTaskStatus(sessionDir, id, status)\`
- \`updateTask(sessionDir, id, patch)\`
- \`setTaskNewInfo(sessionDir, id, value)\`
      `.trim(),
    },

    subtaskMethods: {
      title: "SubTask 方法",
      content: `
- \`createSubTask(sessionDir, taskId, title, assignee?)\`
- \`updateSubTask(sessionDir, taskId, subId, patch)\`
      `.trim(),
    },
  },

  vsIssue: {
    title: "Task vs Issue 选择",
    summary: "经验规则——待讨论的怎么做 → Issue；明确的要做什么 → Task",
    content: `
| 场景 | 用 Issue | 用 Task |
|---|---|---|
| 需求讨论 | ✓ | ✗ |
| 技术决策 | ✓ | ✗ |
| 实施步骤 | ✗ | ✓ |
| 多方分歧 | ✓ | ✗ |
| 单 Object 执行 | ✗ | ✓ |
| 进度跟踪 | 粗粒度 | 细粒度（含 subtasks） |

两者经常并存——Issue 孵化出多个 Task。
    `.trim(),
  },
};
