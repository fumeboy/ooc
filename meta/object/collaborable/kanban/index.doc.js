import { collaborable_v20260504_1 } from "@meta/object/collaborable/index.doc";

export const kanban_v20260506_1 = {
    parent: collaborable_v20260504_1,
    index: `
Kanban 是 Session 级的结构化协作机制。

talk 是**点对点**的合作；kanban 是**结构化的、多方可见的**合作。
当一个话题需要多轮讨论、多人参与、长期跟踪时，单纯的 talk 不够——
需要 Issue 与 Task。

## 核心概念

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

Issue 和 Task 多对多——一个 Issue 可拆成多个 Task，一个 Task 可解决多个 Issue。

## 子文档

- [issue](./issue.doc.js)             需求 / 问题讨论单元
- [task](./task.doc.js)               执行单元
- [comment](./comment.doc.js)         不可变评论
- [concurrent-write](./concurrent-write.doc.js)  并发写入的串行化保护

## 持久化位置

\`\`\`
flows/{sessionId}/
├── issues/
│   ├── index.json              全量 Issue 列表（前端可一次性读取）
│   └── issue-{id}.json         单条 Issue 完整数据（按 id 拉取详情）
└── tasks/
    ├── index.json              全量 Task 列表
    └── task-{id}.json          单条 Task 完整数据
\`\`\`

每条 Issue/Task 同时存在于 index.json 和单条文件——便于前端两种访问模式。

## 谁能写

| 写入方 | 通过什么机制 |
|---|---|
| supervisor | 拥有 \`session-kanban\` 专属 knowledge + server 模块（详见 collaborable/role/supervisor） |
| 其他 Object | 通过 talkable 下 issue-discussion 相关 knowledge（仅评论 / 讨论，不能改 Issue/Task 结构与状态） |
| user        | 后端 HTTP API 直接写 |

三方写入需通过串行化队列保护。详见 [concurrent-write](./concurrent-write.doc.js)。

## hasNewInfo 机制

每个 Issue / Task 有 \`hasNewInfo\` 布尔字段。当有需要**人类确认**的新信息时，
设为 true（前端 UI 显示红点提示）。

人类打开详情页时，自动 reset：
- \`POST /api/sessions/{sid}/issues/{id}/ack\` → 自动 setIssueNewInfo(false)
- \`POST /api/sessions/{sid}/tasks/{id}/ack\`  → 自动 setTaskNewInfo(false)

让用户不错过关键进展，但也不被所有更新淹没。

## reportPages 机制

Issue 和 Task 可关联一个或多个 report 页面（Object 自渲染 client）：

\`\`\`
Task task-001:
  reportPages: [
    "flows/{sid}/objects/alan/client/pages/task-001-result"
  ]
\`\`\`

由负责该 Task 的 Object 在自己的 Flow 目录下生成 client/pages/{name}.tsx，
再通过 updateTask 关联到 Task。前端 Task 详情页的 Reports tab 用动态加载渲染该页。

详见 executable/client。

## Session 级、不跨 Session

kanban 数据归属 Session（路径 \`flows/{sid}/issues|tasks/\`）。
不同 Session 的 kanban 完全独立。

Session 结束后看板数据保留在磁盘，但不再被加载——
对应的 Object Flow 都不再活跃。

## 与 talk 的边界

| 场景 | 用 talk | 用 kanban |
|---|---|---|
| 一对一信息传递 | ✓ | ✗ |
| 多人多轮讨论 | 多发几轮 talk 也行，但难追溯 | ✓ Issue + comments |
| 跟踪执行进度 | ✗ | ✓ Task + subtasks |
| 跨对象协调 | 临时协调 | 结构化协调（多 Object 跨多任务） |
| 让用户看见全貌 | 需要 Object 主动汇报 | 直接前端可视化 |

经验规则：
- 临时一两轮交互 → talk
- 需要多方持续关注 + 状态机推进 → kanban
- 二者经常并用：kanban 提供结构骨架，talk 在每个节点细化沟通
`,
};
