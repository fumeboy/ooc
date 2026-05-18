import type { Concept, DocNode } from "@meta/doc-types";
import { role_v20260506_1 } from "@meta/object/collaborable/role/index.doc";
import * as types from "@src/executable/windows/types";
import * as stoneObject from "@src/persistable/stone-object";
import * as flowObject from "@src/persistable/flow-object";

/* ────────────────────────────────────────────────────────────────
 *  目录页：Supervisor 概念全貌
 * ──────────────────────────────────────────────────────────────── */

/**
 * Supervisor 概念：Session 的总协调者，user 默认对话对象。
 *
 * sources:
 *  - types       — TalkWindow 等运行时类型，承载 user.root 指向 supervisor 的初始通道语义
 *  - stoneObject — supervisor 的静态身份目录（含 session-kanban knowledge）
 *  - flowObject  — supervisor 在某 session 内的运行态目录
 */
export type SupervisorConcept = Concept & {
  sources: {
    types: typeof types;
    stoneObject: typeof stoneObject;
    flowObject: typeof flowObject;
  };

  /** 默认消息路由：未指定 target → supervisor */
  routing: {
    title: string;
    summary?: string;
    routingPath: DocNode;
    defaultTarget: DocNode;
    delegateModel: DocNode;
  };

  /** session-kanban 管理能力 */
  sessionKanban: {
    title: string;
    summary?: string;
    knowledgePath: DocNode;
    privilegeAsymmetry: DocNode;
    serverMethodAccess: DocNode;
  };

  /** 典型 Session 流程：6 个阶段 */
  typicalFlow: {
    title: string;
    summary?: string;
    phase1Initiate: DocNode;
    phase2Plan: DocNode;
    phase3DesignReports: DocNode;
    phase4Dispatch: DocNode;
    phase5VerifyTest: DocNode;
    phase6Close: DocNode;
  };
};

/* ────────────────────────────────────────────────────────────────
 *  数据填充
 * ──────────────────────────────────────────────────────────────── */

export const supervisor_v20260506_1: SupervisorConcept = {
  name: "Supervisor",
  get parent() {
    return role_v20260506_1;
  },
  sources: { types, stoneObject, flowObject },
  description: `
Supervisor 是一个 Object，但担任 Session 的总协调者。

user 通过前端发消息且不指定 target 时，默认路由到 supervisor；supervisor 再决定
把任务分给谁。supervisor 同时拥有 session-kanban 相关 knowledge，可使用
Issue / Task 结构化协作机制。
`.trim(),

  routing: {
    title: "默认消息路由",
    summary: "用户输入到达后端后，若未指定 target，自动路由到 supervisor",

    routingPath: {
      title: "路由路径",
      content: `
\`\`\`
后端 API 接收用户消息
  → 创建 Session（若无活跃 Session）
  → talk("supervisor", { from: "user", content })
  → supervisor 的根线程启动
\`\`\`
      `.trim(),
    },

    defaultTarget: {
      title: "默认 target = supervisor",
      content: `
未指定 target 时一律落到 supervisor，而不是"最近一次对话对象"或"随机"。
这条规则让前端无需维护对话状态——任何新消息都先到 supervisor。
      `.trim(),
    },

    delegateModel: {
      title: "任务再分派",
      content: `
user 看到的是 supervisor，supervisor 再决定把任务分给谁。user 不直接 talk
普通 Object（除非由 supervisor 引入特定上下文）。
      `.trim(),
    },
  },

  sessionKanban: {
    title: "session-kanban 管理能力",
    summary: "supervisor 持有专属 knowledge + server 方法集，是唯一可改 Issue/Task 结构的 Object",

    knowledgePath: {
      title: "专属 knowledge 落盘位置",
      content: `
\`\`\`
stones/supervisor/
└── knowledge/session-kanban.md   描述看板语义、状态机、Issue/Task 关系
\`\`\`
      `.trim(),
    },

    privilegeAsymmetry: {
      title: "权限不对称",
      content: `
普通 Object 通过 talkable 下的 issue-discussion knowledge 只能发评论；
创建 / 改状态 / 改结构由 supervisor 通过 server 方法执行。
这是结构化协作 vs 自由讨论的边界。
      `.trim(),
    },

    serverMethodAccess: {
      title: "server 方法访问",
      content: `
supervisor 通过 server method 直接调用 kanban 写入函数（\`createIssue\` /
\`updateIssueStatus\` / ...），不需要走 HTTP API。普通 Object 没有这些方法的
\`llm_methods\` 注册。
      `.trim(),
    },
  },

  typicalFlow: {
    title: "典型 Session 流程",
    summary: "6 个阶段：发起 → 规划 → 设计回报 → 分派 → 执行验收 → 收尾",

    phase1Initiate: {
      title: "1. user 发起",
      content: `
\`\`\`
user talk("supervisor", "实现 X 功能")
\`\`\`
      `.trim(),
    },

    phase2Plan: {
      title: "2. supervisor 规划与征询设计",
      content: `
\`\`\`
supervisor 读消息：
  - createIssue: "实现 X 功能"
  - 分析涉及后端 + 前端
  - talk("alan", "请设计 X 的后端方案", wait=true)
  - talk("iris", "请设计 X 的前端方案", wait=true)
\`\`\`
      `.trim(),
    },

    phase3DesignReports: {
      title: "3. 设计回报",
      content: `
\`\`\`
alan / iris 各自处理，完成后 talk(target=creator, summary)
\`\`\`
      `.trim(),
    },

    phase4Dispatch: {
      title: "4. supervisor 分派执行",
      content: `
\`\`\`
supervisor 收到回复，inbox 含 alan + iris 的报告：
  - createTask: "实现 X 后端", issueRefs=[issue-001]
  - createTask: "实现 X 前端", issueRefs=[issue-001]
  - talk("coder",    task 详情, wait=true)
  - talk("ui-coder", task 详情, wait=true)
\`\`\`
      `.trim(),
    },

    phase5VerifyTest: {
      title: "5. 执行完成与体验测试",
      content: `
\`\`\`
coder / ui-coder 完成后：
  - updateTaskStatus("task-002", "done")
  - updateTaskStatus("task-003", "done")
  - talk("bruce", "请体验测试", wait=true)
\`\`\`
      `.trim(),
    },

    phase6Close: {
      title: "6. 收尾与汇报",
      content: `
\`\`\`
bruce 完成后：
  - updateIssueStatus("issue-001", "confirming")
  - setIssueNewInfo("issue-001", true)
  - talk("user", 摘要)
  - end
\`\`\`
      `.trim(),
    },
  },
};
