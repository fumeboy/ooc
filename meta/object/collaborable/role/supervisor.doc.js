import { role_v20260506_1 } from "@meta/object/collaborable/role/index.doc";

export const supervisor_v20260506_1 = {
    parent: role_v20260506_1,
    index: `
Supervisor 是一个 Stone，但拥有系统级特权。它是 Session 的总协调者。

## 三个特权

\`\`\`
1. 用户消息默认路由到 supervisor（前端不指定 target 时的 fallback）
2. 拥有 session-kanban 专属 server 模块（看板读写权限）
3. 系统事件（如测试失败）默认投递到 supervisor 的 inbox
\`\`\`

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

## 2. session-kanban 专属能力

supervisor 通过 \`session-kanban\` 这个**只在它自己 stones/supervisor/ 下声明的**
knowledge + server 模块持有看板读写权限：

\`\`\`
stones/supervisor/
├── knowledge/session-kanban.md   描述看板的语义、状态机、与 Issue/Task 的关系
└── server/session-kanban/index.ts
       export const llm_methods = {
         createIssue, updateIssueStatus, updateIssue, closeIssue,
         setIssueNewInfo,
         createTask, updateTaskStatus, updateTask,
         createSubTask, updateSubTask,
         setTaskNewInfo,
       };
\`\`\`

这些方法是 supervisor 自己的 server.ui_methods / llm_methods——
普通 Object 没有这个 server 模块，自然无法调用。

普通 Object 最多通过 talkable 下 issue-discussion 相关 knowledge 在已有 Issue 下评论，
不能改变 Issue / Task 的结构与状态。

注：supervisor 看 Session 当前状态时，是从看板（\`flows/{sid}/issues\` / \`tasks\`）读取数据 +
结合自己的根线程上下文做出判断——而不是调用一个特殊的 "session_overview" API。

## 3. 系统事件投递

部分系统事件会自动投递到 supervisor 的 inbox：
- 测试失败 → \`[test_failure] ...\` 写入 supervisor inbox
- 异常 / 长时间无响应等运维信号

supervisor 下一轮 ThinkLoop 看到 inbox 消息，决定是否介入。

注意：跨对象 Flow 事件**不会**自动广播给 supervisor——
子对象返回结果通过 talk(target=creator, ...) 回流到原调用线程的 inbox，
而不是无差别广播给 supervisor。

## 自渲染 client：Session Kanban 视图

supervisor 通常通过 \`stones/supervisor/client/index.tsx\` 呈现 Session 看板：

\`\`\`
stones/supervisor/
└── client/
    ├── index.tsx              主页：当前 Session 的看板视图
    ├── components/            子组件（Issue 卡片、Task 卡片、过滤器等）
    └── ...
\`\`\`

前端打开 supervisor 详情页时，看到的直接是当前 Session 看板——
不是普通"Stone 详情"。

详见 executable/client。

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

## supervisor 的 readme（典型）

\`\`\`yaml
---
whoAmI: OOC 项目的 Supervisor，1+3 组织的总指挥
---

# 我是 Alan Kay

我是 OOC 项目的 Supervisor。
我不属于任何一个层——我站在所有层之上，负责：

1. 任务拆分
2. 部门调度
3. 跨部门协调
4. 质量把关
5. 战略决策

工作方式：
- 收到任务后，先判断涉及哪些部门，并行或串行 spawn agent 执行
- 简单任务直接自己做
- 复杂任务拆分后分发，自己做 review 和集成
\`\`\`

## 特殊性的本质

supervisor 的"特殊"完全体现在数据 + 默认路由：
- HTTP 入口的默认 target = supervisor（路由配置）
- session-kanban 模块只在 stones/supervisor/server/ 下存在
- 系统事件投递目标默认 = supervisor

但本质上它仍是普通对象：
- 用同样的 knowledge + server + client 三件套
- 用同样的 ThinkLoop
- 文件结构与其他 Object 相同

换一个项目可以把 supervisor 换成另一个对象（如 coordinator），
只需改几处路由默认值，无需改内核代码。
`,
};
