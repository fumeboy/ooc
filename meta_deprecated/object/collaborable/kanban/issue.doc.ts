import type { Concept, DocNode } from "@meta/doc-types";
import { kanban_v20260506_1 } from "@meta/object/collaborable/kanban/index.doc";
import * as flowObject from "@src/persistable/flow-object";
import * as issuePersistence from "@src/persistable/issue";
import * as issueService from "@src/persistable/issue-service";
import * as createIssueCmd from "@src/executable/windows/root/create-issue";
import * as openIssueCmd from "@src/executable/windows/root/open-issue";
import * as issueWindowReg from "@src/executable/windows/issue";
import * as deriveSynthesizer from "@src/thinkable/knowledge/synthesizer";
import * as worker from "@src/app/server/runtime/worker";

/* ────────────────────────────────────────────────────────────────
 *  目录页：Issue 概念全貌
 * ──────────────────────────────────────────────────────────────── */

/**
 * Issue 概念：Session 级的需求 / 问题讨论单元。
 *
 * sources（issue 数据落在 flow 目录的 issues 子树中,完整实现栈在 src/persistable +
 * src/executable/windows + src/thinkable/knowledge + src/app/server）:
 *  - flowObject       — flows/{sid}/objects/{id}/ 目录骨架(承载 issues/ 子树)
 *  - issuePersistence — Issue/Comment/Index 类型 + 文件 IO(U1)
 *  - issueService     — create/append/close 业务 + per-session SerialQueue(U2)
 *  - createIssueCmd   — root.create_issue LLM 命令(U5)
 *  - openIssueCmd     — root.open_issue LLM 命令(U5)
 *  - issueWindowReg   — issue_window 注册 + comment command(U6)
 *  - deriveSynthesizer — 每轮 derive Issue 内容为 KnowledgeWindow(U8)
 *  - worker           — syncIssueWindowComments pull-on-tick + close fallback(U9)
 *
 * implementation status (2026-05-19):
 * - Tier A: 持久化 + 5 个 HTTP endpoint(POST /api/flows/:sid/issues, ...)落地
 * - Tier B: IssueWindow + 3 命令 + wait 扩展 + 双轨 mention + 拉取式通知 落地
 * - 详见 docs/plans/2026-05-19-001-feat-issue-context-window-plan.md
 *
 * LLM 视角(由 LLM 在 thread 中看到的命令面):
 * - 在 root 上 \`create_issue(title, description?)\` 创建并订阅
 * - 在 root 上 \`open_issue(issueId)\` 订阅已存在的 Issue
 * - 在 issue_window 上 \`comment(text, mentions?)\` 发评论(双轨 mention 推荐 args)
 * - 在 issue_window 上通用 \`close\` 退订(其它 thread 不受影响)
 * - 通用 \`wait(on=<issue_window>)\` 进入 wait-all,所有新 comment 都唤醒
 * - 派生 body 每条 comment 用 \`<comment author="X" id="N">...</comment>\` XML
 *   fence 包裹(防 prompt injection)
 * - lastSeenCommentId / lastNotifiedAt 是 in-process 内存语义,不持久化
 *   (重启视 undefined,初值=当前最新 commentId)
 */
export type IssueConcept = Concept & {
  sources: {
    flowObject: typeof flowObject;
    issuePersistence: typeof issuePersistence;
    issueService: typeof issueService;
    createIssueCmd: typeof createIssueCmd;
    openIssueCmd: typeof openIssueCmd;
    issueWindowReg: typeof issueWindowReg;
    deriveSynthesizer: typeof deriveSynthesizer;
    worker: typeof worker;
  };

  /** 数据结构：实体字段 + 状态枚举 */
  shape: {
    title: string;
    summary?: string;
    fields: DocNode;
    statusEnum: DocNode;
  };

  /** 状态流转（非强制状态机） */
  statusFlow: {
    title: string;
    summary?: string;
    diagramShape: DocNode;
    notStrictStateMachine: DocNode;
    closedAsAnywhereExit: DocNode;
  };

  /** participants：参与者字段语义与自动加入规则 */
  participants: {
    title: string;
    summary?: string;
    effects: DocNode;
    autoJoin: DocNode;
  };

  /** hasNewInfo 红点提示与 ack 清零 */
  hasNewInfo: DocNode;

  /** Task 多对多关联 */
  taskRefs: {
    title: string;
    summary?: string;
    bidirectionalUpdate: DocNode;
    manyToManyShape: DocNode;
  };

  /** 关联 Object 自渲染页 */
  reportPages: DocNode;

  /** 典型 server 方法集与权限边界 */
  operations: {
    title: string;
    summary?: string;
    writeMethods: DocNode;
    permissionBoundary: DocNode;
  };

  /** 评论入口 */
  comments: DocNode;

  /** 并发写入入口 */
  concurrency: DocNode;
};

/* ────────────────────────────────────────────────────────────────
 *  数据填充
 * ──────────────────────────────────────────────────────────────── */

export const issue_v20260506_1: IssueConcept = {
  name: "Issue",
  get parent() {
    return kanban_v20260506_1;
  },
  sources: {
    flowObject,
    issuePersistence,
    issueService,
    createIssueCmd,
    openIssueCmd,
    issueWindowReg,
    deriveSynthesizer,
    worker,
  },
  description: `
Issue 是 Session 级的需求 / 问题讨论单元。跨对象讨论，多对多关联 Task。
`.trim(),

  shape: {
    title: "数据结构",
    summary: "实体字段定义 + IssueStatus 枚举",

    fields: {
      title: "字段",
      content: `
\`\`\`typescript
interface Issue {
  id: string;                       // "issue-001"
  title: string;
  status: IssueStatus;
  description?: string;             // markdown
  participants: string[];           // 参与讨论的对象名列表
  taskRefs: string[];               // 关联的 Task id
  reportPages: string[];            // 关联的 report client 页路径
  hasNewInfo: boolean;              // 是否有需要人类确认的新信息
  comments: Comment[];              // 评论列表（追加为主）
  createdAt: string;
  updatedAt: string;
}
\`\`\`
      `.trim(),
    },

    statusEnum: {
      title: "IssueStatus 枚举",
      content: `
\`\`\`typescript
type IssueStatus =
  | "discussing"     // 讨论中
  | "designing"      // 设计中
  | "reviewing"      // 评审中
  | "executing"      // 执行中
  | "confirming"     // 确认中
  | "done"           // 完成
  | "closed";        // 关闭（放弃 / 已解决）
\`\`\`
      `.trim(),
    },
  },

  statusFlow: {
    title: "状态流转",
    summary: "happy path 链 + closed 任意出口；非强制状态机",

    diagramShape: {
      title: "主流转链",
      content: `
\`\`\`
discussing → designing → reviewing → executing → confirming → done
                                                                ↓
                            （任何阶段也可直接 → closed，表示放弃）
\`\`\`

这是"happy path"的预期顺序，但不强制。
      `.trim(),
    },

    notStrictStateMachine: {
      title: "不是强制状态机",
      content: `
可以跳过阶段、可以回退。由 supervisor 或人类判断当前所处阶段——系统不校验
状态转移合法性。这个宽松设计避免把现实协作硬塞进固定流程。
      `.trim(),
    },

    closedAsAnywhereExit: {
      title: "closed 是任意阶段的出口",
      content: `
任何阶段都可以直接 → closed，表示"放弃 / 已解决但不归档为 done"。
closed 与 done 的差别：done 表示成功完成；closed 表示终止但不一定成功。
      `.trim(),
    },
  },

  participants: {
    title: "participants",
    summary: "记录谁在关注本 Issue 的字段",

    effects: {
      title: "participant 列表的对外效果",
      content: `
- Issue 关键更新时（status 变化、comment 新增等）通知 participants 中的对象
- 前端在 Issue 详情页侧栏展示参与者头像
- 新增 participant 时该对象 inbox 收到"你被邀请到 issue-XXX 讨论"
      `.trim(),
    },

    autoJoin: {
      title: "评论触发的自动加入规则",
      content: `
- 评论作者若不是 user 且不在 participants 中，自动加入
- mentions 中的对象不自动加入（避免被 @ 即被绑定）
      `.trim(),
    },
  },

  hasNewInfo: {
    title: "hasNewInfo",
    summary: "需要人类确认的新信息时设为 true，前端显示红点",
    content: `
当 Issue 有"需要人类确认"的新信息时（如方案初稿 / 关键决策 / 完成态等），设为 true：

- 前端在 Issue 卡片上显示红点
- 人类打开详情页 → 后端调 \`POST /api/sessions/{sid}/issues/{id}/ack\` → 自动清零
    `.trim(),
  },

  taskRefs: {
    title: "taskRefs（多对多）",
    summary: "Issue 与 Task 通过 taskRefs / issueRefs 双向维护关联",

    bidirectionalUpdate: {
      title: "双向更新约束",
      content: `
新增关联时两侧都要更新，避免出现"A 引用 X 但 X 不知道"的不一致。
通过 server method 集中维护——LLM 不直接改 refs 数组，调 linkTaskToIssue / unlink。
      `.trim(),
    },

    manyToManyShape: {
      title: "多对多形态",
      content: `
\`\`\`
Issue A — taskRefs: [task-X, task-Y]
Task X — issueRefs: [Issue A]
Task Y — issueRefs: [Issue A, Issue B]
\`\`\`

一个 Issue 可拆为多个 Task，一个 Task 可解决多个 Issue。这是真正的多对多
（不是树结构）——前端 viewer 必须支持双向跳转。
      `.trim(),
    },
  },

  reportPages: {
    title: "reportPages",
    summary: "关联 Object 自渲染的 client 页路径列表",
    content: `
\`\`\`json
{
  "reportPages": [
    "flows/{sid}/objects/alan/client/pages/issue-001-design"
  ]
}
\`\`\`

前端 Issue 详情页的 Reports tab 用动态加载渲染该页。详见 executable/client。
    `.trim(),
  },

  operations: {
    title: "典型操作",
    summary: "supervisor 通过 server 方法操作；权限严格 vs 普通 Object",

    writeMethods: {
      title: "写入方法集",
      content: `
- \`createIssue(sessionDir, title, description?, participants?)\` → 返回 issue-001
- \`updateIssueStatus(sessionDir, id, status)\` → 切换状态
- \`updateIssue(sessionDir, id, patch)\` → 部分字段更新
- \`setIssueNewInfo(sessionDir, id, value)\` → 切红点
- \`closeIssue(sessionDir, id)\` → 关闭
      `.trim(),
    },

    permissionBoundary: {
      title: "权限边界",
      content: `
普通 Object 通过 talkable 下 issue-discussion 相关 knowledge 只能评论，
不能改结构。Issue / Task / SubTask 的结构与状态修改专属 supervisor。
      `.trim(),
    },
  },

  comments: {
    title: "评论",
    summary: "Issue 下的评论单元详见 comment 子概念",
    content: "详见 kanban.concepts.comment（refs.comment）。",
  },

  concurrency: {
    title: "写入路径与并发",
    summary: "三方写入通过 SerialQueue per-sessionDir 串行化",
    content: "涉及多方写入：supervisor / 其他 Object / user API。详见 concurrentWrite（refs.concurrentWrite）。",
  },
};
