import * as flowObject from "@src/persistable/flow-object";
import { kanban_v20260506_1 } from "@meta/object/collaborable/kanban/index.doc";

/**
 * Task 概念：Session 级的执行单元。
 *
 * sources（task 数据落在 flow 目录的 tasks 子树中）:
 *  - flowObject — flows/{sid}/objects/{id}/ 目录骨架，承载 tasks/ 子树
 */
export const task_v20260506_1 = {
  name: "Task",
  get parent() { return kanban_v20260506_1; },
  sources: {
    flowObject,
  },
  description: `
Task 是 Session 级的执行单元，多对多关联 Issue。

按子字段展开（见各子字段）：

- shape — 数据结构
- statusFlow — 简化的状态枚举
- subtasks — SubTask 列表与 assignee 通知
- issueRefs — 与 Issue 的双向多对多关联
- hasNewInfo — 红点提示与 ack 清零
- reportPages — 关联 Object 自渲染页
- operations — 典型 server 方法
- vsIssue — Task 与 Issue 的选择经验
`.trim(),

  shape_v20260517_1: {
    index: `
## 数据结构

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

interface SubTask {
  id: string;                       // "sub-001"（在所属 Task 内自增）
  title: string;
  assignee?: string;                // 负责的 Object 名
  status: "pending" | "running" | "done";
}
\`\`\`
`.trim(),
  },

  statusFlow_v20260517_1: {
    index: `
## 状态

\`\`\`
running  → done  → closed
\`\`\`

比 Issue 简单：Task 是执行单元，要么在做、要么做完、要么归档。
`.trim(),
  },

  subtasks_v20260517_1: {
    index: `
## SubTask

Task 可有 SubTask 列表：

\`\`\`json
{
  "subtasks": [
    { "id": "sub-001", "title": "设计数据结构", "assignee": "alan",  "status": "done" },
    { "id": "sub-002", "title": "实现 API",     "assignee": "coder", "status": "running" },
    { "id": "sub-003", "title": "写测试",       "assignee": "coder", "status": "pending" }
  ]
}
\`\`\`

SubTask 不是独立的 Task——它是 Task 的"分步"。
轻量结构，不支持独立评论或 reportPages。
SubTask id 在所属 Task 内自增（不跨 Task 唯一）。

### 自动通知 assignee

某 Object 被分配到 SubTask 时，系统通知该 Object：

\`\`\`
Alan 被分配 sub-001：
  → Alan 的 inbox 收到 \`[new] 你被分配到 task-001 的子任务 sub-001：实现 wait 唤醒逻辑\`
\`\`\`

Object 开始处理后，可主动 updateSubTask 把 status 改为 running，完成后改为 done。
`.trim(),
  },

  issueRefs_v20260517_1: {
    index: `
## issueRefs（多对多）

与 Issue 双向关联，新增 / 修改时两侧都要更新。详见 \`collaborable.kanban.issue\`。
`.trim(),
  },

  hasNewInfo_v20260517_1: {
    index: `
## hasNewInfo

与 Issue 同：有需要人类确认的新信息时设为 true，前端显示红点。

典型触发：

- Task 完成需要人工验收
- 执行中遇到阻碍需要决策

人类打开详情页 → \`POST /api/sessions/{sid}/tasks/{id}/ack\` → 自动清零。
`.trim(),
  },

  reportPages_v20260517_1: {
    index: `
## reportPages

Task 完成后的结果展示页面。由负责 Object 在自己的 Flow 目录下生成
\`client/pages/{name}.tsx\`，再通过 updateTask 关联：

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

  operations_v20260517_1: {
    index: `
## 典型操作

由 supervisor 通过 server 方法操作：

- createTask(sessionDir, title, description?, issueRefs?)
- updateTaskStatus(sessionDir, id, status)
- updateTask(sessionDir, id, patch)
- createSubTask(sessionDir, taskId, title, assignee?)
- updateSubTask(sessionDir, taskId, subId, patch)
- setTaskNewInfo(sessionDir, id, value)
`.trim(),
  },

  vsIssue_v20260517_1: {
    index: `
## Task vs Issue 选择

| 场景 | 用 Issue | 用 Task |
|---|---|---|
| 需求讨论 | ✓ | ✗ |
| 技术决策 | ✓ | ✗ |
| 实施步骤 | ✗ | ✓ |
| 多方分歧 | ✓ | ✗ |
| 单 Object 执行 | ✗ | ✓ |
| 进度跟踪 | 粗粒度 | 细粒度（含 subtasks）|

经验规则：**待讨论的"怎么做" → Issue；明确的"要做什么" → Task**。
两者经常并存——Issue 孵化出多个 Task。
`.trim(),
  },
};
