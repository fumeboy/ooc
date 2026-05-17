import * as types from "@src/executable/windows/types";
import * as stoneObject from "@src/persistable/stone-object";
import * as flowObject from "@src/persistable/flow-object";
import { role_v20260506_1 } from "@meta/object/collaborable/role/index.doc";

/**
 * Supervisor 概念：Session 的总协调者，user 默认对话对象。
 *
 * sources:
 *  - types       — TalkWindow 等运行时类型，承载 user.root 指向 supervisor 的初始通道语义
 *  - stoneObject — supervisor 的静态身份目录（含 session-kanban knowledge）
 *  - flowObject  — supervisor 在某 session 内的运行态目录
 */
export const supervisor_v20260506_1 = {
  name: "Supervisor",
  get parent() { return role_v20260506_1; },
  sources: {
    types,
    stoneObject,
    flowObject,
  },
  description: `
Supervisor 是一个 Object，但担任 Session 的总协调者。

user 通过前端发消息且不指定 target 时，默认路由到 supervisor；
supervisor 再决定把任务分给谁。supervisor 同时拥有 session-kanban 相关
knowledge，可使用 Issue / Task 结构化协作机制。

具体子设计见各子字段。
`.trim(),

  routing_v20260517_1: {
    index: `
## 默认消息路由

用户输入到达后端后，若未指定 target：

\`\`\`
后端 API 接收用户消息
  → 创建 Session（若无活跃 Session）
  → talk("supervisor", { from: "user", content })
  → supervisor 的根线程启动
\`\`\`

user 看到的是 supervisor，supervisor 再决定把任务分给谁。
`.trim(),
  },

  sessionKanban_v20260517_1: {
    index: `
## session-kanban 管理能力

supervisor 在自己的 stone 目录下持有专属 knowledge：

\`\`\`
stones/supervisor/
└── knowledge/session-kanban.md   描述看板语义、状态机、Issue/Task 关系
\`\`\`

普通 Object 通过 talkable 下的 issue-discussion knowledge 只能发评论；
创建 / 改状态 / 改结构由 supervisor 通过 server 方法执行。
`.trim(),
  },

  typicalFlow_v20260517_1: {
    index: `
## 典型 Session 流程

\`\`\`
1. user talk("supervisor", "实现 X 功能")

2. supervisor 读消息：
   - createIssue: "实现 X 功能"
   - 分析涉及后端 + 前端
   - talk("alan", "请设计 X 的后端方案", wait=true)
   - talk("iris", "请设计 X 的前端方案", wait=true)

3. alan / iris 各自处理，完成后 talk(target=creator, summary)

4. supervisor 收到回复，inbox 含 alan + iris 的报告：
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
   - setIssueNewInfo("issue-001", true)
   - talk("user", 摘要)
   - end
\`\`\`
`.trim(),
  },
};
