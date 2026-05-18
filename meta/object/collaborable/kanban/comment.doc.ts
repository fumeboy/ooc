import type { Concept, DocNode, InvariantNode } from "@meta/doc-types";
import { kanban_v20260506_1 } from "@meta/object/collaborable/kanban/index.doc";
import * as flowObject from "@src/persistable/flow-object";

/* ────────────────────────────────────────────────────────────────
 *  目录页：Comment 概念全貌
 * ──────────────────────────────────────────────────────────────── */

/**
 * Comment 概念：Issue 下不可变的评论单元。
 *
 * sources（comment 数据落在 flow 目录的 issues 子树中）:
 *  - flowObject — flows/{sid}/objects/{id}/ 目录骨架，承载 issues/ 子树
 */
export type CommentConcept = Concept & {
  sources: { flowObject: typeof flowObject };

  /** 数据结构：字段定义 + 存储位置 */
  shape: {
    title: string;
    summary?: string;
    fields: DocNode;
    storage: DocNode;
  };

  /** 不可变性：两条核心理由 */
  immutability: {
    title: string;
    summary?: string;
    immutable: InvariantNode;
    reasonHonesty: DocNode;
    reasonReflection: DocNode;
  };

  /** 创建路径：调用入口 + 系统自动填充 */
  creation: {
    title: string;
    summary?: string;
    entries: DocNode;
    autoFields: DocNode;
  };

  /** mentions 机制：投递 / 渲染 / 与 participants 的边界 */
  mentions: {
    title: string;
    summary?: string;
    delivery: DocNode;
    rendering: DocNode;
    participantsBoundary: DocNode;
  };

  /** 副作用：作者自动加入 / 刷新 updatedAt / mentions 通知 */
  sideEffects: {
    title: string;
    summary?: string;
    autoJoinAuthor: DocNode;
    refreshUpdatedAt: DocNode;
    triggerMentions: DocNode;
  };

  /** 时序展示规则 */
  ordering: DocNode;
};

/* ────────────────────────────────────────────────────────────────
 *  数据填充
 * ──────────────────────────────────────────────────────────────── */

export const comment_v20260506_1: CommentConcept = {
  name: "Comment",
  get parent() {
    return kanban_v20260506_1;
  },
  sources: { flowObject },
  description: `
Comment 是 Issue 下的评论单元。一经创建即不可修改，是 OOC 行动记录不可变约束的体现。
`.trim(),

  shape: {
    title: "数据结构",
    summary: "字段定义 + 存储位置",

    fields: {
      title: "字段",
      content: `
\`\`\`typescript
interface Comment {
  id: string;            // 在所属 Issue 内自增，如 "comment-001"
  author: string;        // Object 名（或 "user" 表示人类）
  content: string;       // markdown
  mentions?: string[];   // 显式列出的 @ 对象名列表
  createdAt: string;     // ISO 时间戳
}
\`\`\`
      `.trim(),
    },

    storage: {
      title: "存储位置",
      content: `
- \`flows/{sid}/issues/{issueId}.json\` 的 \`comments\` 数组
- 同时镜像到 \`flows/{sid}/issues/index.json\` 中对应 Issue 的 \`comments\` 字段

镜像写入由 SerialQueue 保护，详见 concurrentWrite.indexSync（refs.indexSync）。
      `.trim(),
    },
  },

  immutability: {
    title: "不可变性",
    summary: "Comment 没有 updatedAt 字段——历史只读，新评论纠正",

    immutable: {
      kind: "invariant",
      title: "Comment 一经创建不可修改",
      summary: "无 updatedAt 字段，纠正必须发新评论",
      content: "Comment 没有 updatedAt 字段。需要纠正时发新 comment 说明，原 comment 保留。",
      rationale: `
如果允许修改，作者可以事后美化自己说过的话，反思机制（reflectable）也就失去
真实历史这个素材根基——只剩"当前想让人相信的历史"。
      `.trim(),
    },

    reasonHonesty: {
      title: "诚实",
      content: `
不可变让历史成为客观事实，而不是当前可被改写的版本——作者无法事后美化自己
说过的话。
      `.trim(),
    },

    reasonReflection: {
      title: "反思素材的真实性",
      content: `
反思机制（reflectable）需要真实历史作为素材；若评论可改则没有"真实的历史"，
反思失去根基。
      `.trim(),
    },
  },

  creation: {
    title: "创建 Comment",
    summary: "任何 Object（含 user）都可创建评论",

    entries: {
      title: "调用入口",
      content: `
- Object 通过 talkable 下 issue-discussion 相关的 server 方法
- user 通过后端 HTTP API：\`POST /api/sessions/{sid}/issues/{issueId}/comments\`
      `.trim(),
    },

    autoFields: {
      title: "系统自动填充",
      content: `
- \`id\` —— 在所属 Issue 的 comments 内自增
- \`author\` —— 调用方上下文中的对象名
- \`createdAt\` —— 当前时间
      `.trim(),
    },
  },

  mentions: {
    title: "mentions 机制",
    summary: "作者显式传入的对象列表，系统不从 content 自动解析 @name",

    delivery: {
      title: "消息投递",
      content: `
mentions 中每个对象（剔除作者自身）通过 inbox 收到通知：

\`\`\`
[@you-name 在 issue-XXX 中提到你]
\`\`\`
      `.trim(),
    },

    rendering: {
      title: "前端高亮",
      content: "评论渲染时 @name 显示为可点击链接，点击跳转到对应 Object 的详情页。",
    },

    participantsBoundary: {
      title: "与 participants 的边界",
      content: `
被 @ 的对象**不会**自动加入 \`Issue.participants\`，避免"被 @ 即被绑定到长期跟踪
列表"。需要长期参与时由作者显式调用 updateIssue 添加。
      `.trim(),
    },
  },

  sideEffects: {
    title: "副作用",
    summary: "创建评论时附带的三类状态更新",

    autoJoinAuthor: {
      title: "作者自动加入 participants",
      content: `
若 \`author !== "user"\` 且不在 \`issue.participants\` 中，作者被自动加入 participants。
user 例外——user 评论后不被加入 participants（user 不是"长期跟踪者"角色）。
      `.trim(),
    },

    refreshUpdatedAt: {
      title: "刷新 issue.updatedAt",
      content: `
\`issue.updatedAt\` 被设为评论的 \`createdAt\`，让"最近活跃" Issue 上浮到前端列表头。
      `.trim(),
    },

    triggerMentions: {
      title: "触发 mentions 通知",
      content: "mentions 字段中的对象（剔除作者自身）通过 inbox 收到通知，详见 mentions.delivery。",
    },
  },

  ordering: {
    title: "时序展示",
    summary: "前端按 createdAt 升序展示，comments 不改写则时间戳客观可信",
    content: `
\`\`\`
2026-04-21 10:00 [alan]        @supervisor 我发现了一个问题...
2026-04-21 10:05 [supervisor]  @alan 能详细说说吗
2026-04-21 10:07 [user]        看起来是线程调度的 bug
\`\`\`
    `.trim(),
  },
};
