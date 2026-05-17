import * as flowObject from "@src/persistable/flow-object";
import { kanban_v20260506_1 } from "@meta/object/collaborable/kanban/index.doc";

/**
 * Comment 概念：Issue 下不可变的评论单元。
 *
 * sources（comment 数据落在 flow 目录的 issues 子树中）:
 *  - flowObject — flows/{sid}/objects/{id}/ 目录骨架，承载 issues/ 子树
 */
export const comment_v20260506_1 = {
  name: "Comment",
  get parent() { return kanban_v20260506_1; },
  sources: {
    flowObject,
  },
  description: `
Comment 是 Issue 下的评论单元。一经创建即不可修改，是 OOC 行动记录不可变约束的体现。

按子字段展开（见各子字段）：

- shape — 数据结构与存储位置
- immutability — 为什么不允许修改
- creation — 创建者与系统自动填充字段
- mentions — 显式 @ 机制与投递效果
- sideEffects — 创建评论时附带的状态更新
- ordering — 时序展示规则
`,

  shape_v20260517_1: {
    title: "数据结构",
    content: `
Comment 由两部分构成：字段定义（fields）与存储位置（storage）。
    `,

    fields_v20260517_1: {
      title: "字段",
      content: `
typescript
interface Comment {
  id: string;            // 在所属 Issue 内自增，如 "comment-001"
  author: string;        // Object 名（或 "user" 表示人类）
  content: string;       // markdown
  mentions?: string[];   // 显式列出的 @ 对象名列表
  createdAt: string;     // ISO 时间戳
}

      `,
    },

    storage_v20260517_1: {
      title: "存储位置",
      content: `
- flows/{sid}/issues/{issueId}.json 的 comments 数组
- 同时镜像到 flows/{sid}/issues/index.json 中对应 Issue 的 comments 字段

镜像写入由 SerialQueue 保护（详见 collaborable.kanban.concurrentWrite.indexSync）。
      `,
    },
  },

  immutability_v20260517_1: {
    title: "不可变性",
    content: `
Comment 没有 updatedAt 字段。需要纠正时发新 comment 说明，原 comment 保留。
两个核心理由见子节点。
    `,

    reasonHonesty_v20260517_1: {
      title: "诚实",
      content: `
如果允许修改，作者可能事后美化自己说过的话；不可变让历史成为客观事实，
而不是当前可被改写的版本。
      `,
    },

    reasonReflection_v20260517_1: {
      title: "反思素材的真实性",
      content: `
反思机制（详见 reflectable）需要真实历史作为素材；若评论可改，则没有
"真实的历史"，只有"当前想让人相信的历史"，反思失去根基。
      `,
    },
  },

  creation_v20260517_1: {
    title: "创建 Comment",
    content: `
任何 Object（含 user）都可创建评论。详见两个子节点：调用入口与系统自动填充字段。
    `,

    entries_v20260517_1: {
      title: "调用入口",
      content: `
- Object 通过 talkable 下 issue-discussion 相关的 server 方法
- user 通过后端 HTTP API：POST /api/sessions/{sid}/issues/{issueId}/comments
      `,
    },

    autoFields_v20260517_1: {
      title: "系统自动填充",
      content: `
- id —— 在所属 Issue 的 comments 内自增
- author —— 调用方上下文中的对象名
- createdAt —— 当前时间
      `,
    },
  },

  mentions_v20260517_1: {
    title: "mentions 机制",
    content: `
mentions 是作者显式传入的对象列表，系统不从 content 自动解析 @name。
详见三个子节点：消息投递、前端渲染、participants 边界。
    `,

    delivery_v20260517_1: {
      title: "消息投递",
      content: `
mentions 中每个对象（剔除作者自身）通过 inbox 收到通知：


[@you-name 在 issue-XXX 中提到你]

      `,
    },

    rendering_v20260517_1: {
      title: "前端高亮",
      content: `
评论渲染时 @name 显示为可点击链接，点击跳转到对应 Object 的详情页。
      `,
    },

    participantsBoundary_v20260517_1: {
      title: "与 participants 的边界",
      content: `
被 @ 的对象**不会**自动加入 Issue.participants，避免被 @ 即被绑定到
长期跟踪列表。需要长期参与时由作者显式调用 updateIssue 添加。
      `,
    },
  },

  sideEffects_v20260517_1: {
    title: "副作用",
    content: `
创建评论时触发三类副作用。每类独立子节点。
    `,

    autoJoinAuthor_v20260517_1: {
      title: "作者自动加入 participants",
      content: `
若 author !== "user" 且不在 issue.participants 中，作者被自动加入 participants。
user 例外——user 评论后不被加入 participants（user 不是"长期跟踪者"角色）。
      `,
    },

    refreshUpdatedAt_v20260517_1: {
      title: "刷新 issue.updatedAt",
      content: `
issue.updatedAt 被设为评论的 createdAt，让"最近活跃" Issue 上浮到前端列表头。
      `,
    },

    triggerMentions_v20260517_1: {
      title: "触发 mentions 通知",
      content: `
mentions 字段中的对象（剔除作者自身）通过 inbox 收到通知。详见 mentions
子字段的 delivery 子节点。
      `,
    },
  },

  ordering_v20260517_1: {
    title: "时序展示",
    content: `
前端按 createdAt 升序展示：


2026-04-21 10:00 [alan]        @supervisor 我发现了一个问题...
2026-04-21 10:05 [supervisor]  @alan 能详细说说吗
2026-04-21 10:07 [user]        看起来是线程调度的 bug


comments 不改写，时间戳客观可信。
    `,
  },
};
