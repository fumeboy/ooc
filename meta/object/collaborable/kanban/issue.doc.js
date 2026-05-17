import * as flowObject from "@src/persistable/flow-object";
import { kanban_v20260506_1 } from "@meta/object/collaborable/kanban/index.doc";

/**
 * Issue 概念：Session 级的需求 / 问题讨论单元。
 *
 * sources（issue 数据落在 flow 目录的 issues 子树中）:
 *  - flowObject — flows/{sid}/objects/{id}/ 目录骨架，承载 issues/ 子树
 */
export const issue_v20260506_1 = {
  name: "Issue",
  get parent() { return kanban_v20260506_1; },
  sources: {
    flowObject,
  },
  description: `
Issue 是 Session 级的需求 / 问题讨论单元。跨对象讨论，多对多关联 Task。

按子字段展开（见各子字段）：

- shape — 数据结构与状态枚举
- statusFlow — 状态流转（非强制状态机）
- participants — 参与者字段语义
- hasNewInfo — 红点提示与 ack 清零
- taskRefs — 与 Task 的双向多对多关联
- reportPages — 关联 Object 自渲染页
- operations — 典型 server 方法
- comments — 评论入口
- concurrency — 并发写入入口
`,

  shape_v20260517_1: {
    title: "数据结构",
    content: `
Issue 由两部分组成：实体字段（fields）与状态枚举（statusEnum）。详见子节点。
    `,

    fields_v20260517_1: {
      title: "字段",
      content: `
typescript
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

      `,
    },

    statusEnum_v20260517_1: {
      title: "IssueStatus 枚举",
      content: `
typescript
type IssueStatus =
  | "discussing"     // 讨论中
  | "designing"      // 设计中
  | "reviewing"      // 评审中
  | "executing"      // 执行中
  | "confirming"     // 确认中
  | "done"           // 完成
  | "closed";        // 关闭（放弃 / 已解决）


状态流转规则与运行规则分别见 statusFlow / operations 子节点。
      `,
    },
  },

  statusFlow_v20260517_1: {
    title: "状态流转",
    content: `

discussing  → designing → reviewing → executing → confirming → done
                                                                  ↓
                              （任何阶段也可直接 → closed，表示放弃）


详见三个子节点：流转图、非强制状态机、closed 例外路径。
    `,

    diagramShape_v20260517_1: {
      title: "主流转链",
      content: `
discussing → designing → reviewing → executing → confirming → done。
这是"happy path"的预期顺序，但不强制。
      `,
    },

    notStrictStateMachine_v20260517_1: {
      title: "不是强制状态机",
      content: `
可以跳过阶段、可以回退。由 supervisor 或人类判断当前所处阶段——系统不校验
状态转移合法性。这个宽松设计避免把现实协作硬塞进固定流程。
      `,
    },

    closedAsAnywhereExit_v20260517_1: {
      title: "closed 是任意阶段的出口",
      content: `
任何阶段都可以直接 → closed，表示"放弃 / 已解决但不归档为 done"。
closed 与 done 的差别：done 表示成功完成；closed 表示终止但不一定成功。
      `,
    },
  },

  participants_v20260517_1: {
    title: "participants",
    content: `
participants 字段记录"谁在关注本 Issue"。详见两个子节点：被动效果与
评论触发的自动加入规则。
    `,

    effects_v20260517_1: {
      title: "participant 列表的对外效果",
      content: `
- Issue 关键更新时（status 变化、comment 新增等）通知 participants 中的对象
- 前端在 Issue 详情页侧栏展示参与者头像
- 新增 participant 时该对象 inbox 收到 你被邀请到 issue-XXX 讨论
      `,
    },

    autoJoin_v20260517_1: {
      title: "评论触发的自动加入规则",
      content: `
- 评论作者若不是 user 且不在 participants 中，自动加入
- mentions 中的对象不自动加入（避免被 @ 即被绑定）
      `,
    },
  },

  hasNewInfo_v20260517_1: {
    title: "hasNewInfo",
    content: `
当 Issue 有"需要人类确认"的新信息时（如方案初稿 / 关键决策 / 完成态等），设为 true：

- 前端在 Issue 卡片上显示红点
- 人类打开详情页 → 后端调 POST /api/sessions/{sid}/issues/{id}/ack → 自动清零
    `,
  },

  taskRefs_v20260517_1: {
    title: "taskRefs（多对多）",
    content: `
Issue 与 Task 通过 taskRefs / issueRefs 双向维护关联：


Issue A — taskRefs: [task-X, task-Y]
Task X — issueRefs: [Issue A]
Task Y — issueRefs: [Issue A, Issue B]


详见两个子节点。
    `,

    bidirectionalUpdate_v20260517_1: {
      title: "双向更新约束",
      content: `
新增关联时两侧都要更新，避免出现"A 引用 X 但 X 不知道"的不一致。
通过 server method 集中维护——LLM 不直接改 refs 数组，调 linkTaskToIssue / unlink。
      `,
    },

    manyToManyShape_v20260517_1: {
      title: "多对多形态",
      content: `
一个 Issue 可拆为多个 Task，一个 Task 可解决多个 Issue。这是真正的多对多
（不是树结构）——前端 viewer 必须支持双向跳转。
      `,
    },
  },

  reportPages_v20260517_1: {
    title: "reportPages",
    content: `
关联 Object 自渲染的 client 页：

json
{
  "reportPages": [
    "flows/{sid}/objects/alan/client/pages/issue-001-design"
  ]
}


前端 Issue 详情页的 Reports tab 用动态加载渲染该页。
    `,
  },

  operations_v20260517_1: {
    title: "典型操作",
    content: `
由 supervisor 通过 server 方法操作（详见 collaborable.supervisor）。
分两组：写入方法集（writeMethods）与权限边界（permissionBoundary）。
    `,

    writeMethods_v20260517_1: {
      title: "写入方法集",
      content: `
- createIssue(sessionDir, title, description?, participants?)  → 返回 issue-001
- updateIssueStatus(sessionDir, id, status)                    → 切换状态
- updateIssue(sessionDir, id, patch)                           → 部分字段更新
- setIssueNewInfo(sessionDir, id, value)                       → 切红点
- closeIssue(sessionDir, id)                                   → 关闭
      `,
    },

    permissionBoundary_v20260517_1: {
      title: "权限边界",
      content: `
普通 Object 通过 talkable 下 issue-discussion 相关 knowledge 只能评论，
不能改结构。Issue / Task / SubTask 的结构与状态修改专属 supervisor。
      `,
    },
  },

  comments_v20260517_1: {
    title: "评论",
    content: `
详见 collaborable.kanban.comment。
    `,
  },

  concurrency_v20260517_1: {
    title: "写入路径与并发",
    content: `
涉及多方写入：supervisor / 其他 Object / user API。
通过 SerialQueue per-sessionDir 串行化，详见 collaborable.kanban.concurrentWrite。
    `,
  },
};
