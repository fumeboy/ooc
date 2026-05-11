import { role_v20260506_1 } from "@meta/object/collaborable/role/index.doc";

export const supervisor_v20260506_1 = {
  get parent() { return role_v20260506_1; },
  index: `
Supervisor 是一个对象，但拥有系统级特权。它是 Session 的总协调者。

## 1. 默认消息路由

用户通过前端发消息，不指定 target 时，默认走 supervisor：

\`\`\`
用户输入："帮我实现 X"
  → 后端 API 接收
  → 创建 Session（如果没有活跃的）
  → talk("supervisor", { from: "user", content: "帮我实现 X" })
  → supervisor 的根线程启动
\`\`\`

设计选择：用户面对 OOC 时，看到的是 supervisor——supervisor 再决定把任务分给谁。

## 2. session-kanban 管理功能

supervisor 具有知识能够使用 kanban 系统

\`\`\`
stones/supervisor/
└── knowledge/session-kanban.md   描述看板的语义、状态机、与 Issue/Task 的关系
\`\`\`

## 典型 Session 流程

\`\`\`
1. 用户 talk("supervisor", "实现 X 功能")

2. supervisor 读消息：
   - createIssue: "实现 X 功能"
   - 分析：涉及后端 + 前端
   - talk("alan", "请设计 X 的后端方案", wait=true)
   - talk("iris", "请设计 X 的前端方案", wait=true)

3. alan / iris 各自处理，完成后 talk(target=creator, summary)

4. supervisor 收到回复，inbox 有 alan + iris 的报告：
   - createTask: "实现 X 后端", issueRefs=[issue-001]
   - createTask: "实现 X 前端", issueRefs=[issue-001]
   - talk("coder",    task 详情, wait=true)
   - talk("ui-coder", task 详情, wait=true)

5. coder / ui-coder 完成后：
   - updateTaskStatus("task-002", "done")
   - updateTaskStatus("task-003", "done")
   - talk("bruce", "请体验测试", wait=true)

6. bruce 完成后：
   - updateIssueStatus("issue-001", "confirming")
   - setIssueNewInfo("issue-001", true)   // 请用户确认
   - talk("user", 摘要)
   - end                                   // 等用户确认后再视情况复活
\`\`\`
`,
};
