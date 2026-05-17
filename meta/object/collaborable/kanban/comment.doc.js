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
`.trim(),

  shape_v20260517_1: {
    index: `
## 数据结构

Comment 由两部分构成：字段定义（\`fields\`）与存储位置（\`storage\`）。
`.trim(),

    fields_v20260517_1: {
      index: `
### 字段

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

    storage_v20260517_1: {
      index: `
### 存储位置

- \`flows/{sid}/issues/{issueId}.json\` 的 \`comments\` 数组
- 同时镜像到 \`flows/{sid}/issues/index.json\` 中对应 Issue 的 comments 字段

镜像写入由 SerialQueue 保护（详见 \`collaborable.kanban.concurrentWrite.indexSync\`）。
`.trim(),
    },
  },

  immutability_v20260517_1: {
    index: `
## 不可变性

Comment 没有 \`updatedAt\` 字段。需要纠正时发新 comment 说明，原 comment 保留。
两个核心理由见子节点。
`.trim(),

    reasonHonesty_v20260517_1: {
      index: `
### 诚实

如果允许修改，作者可能事后美化自己说过的话；不可变让历史成为客观事实，
而不是当前可被改写的版本。
`.trim(),
    },

    reasonReflection_v20260517_1: {
      index: `
### 反思素材的真实性

反思机制（详见 reflectable）需要真实历史作为素材；若评论可改，则没有
"真实的历史"，只有"当前想让人相信的历史"，反思失去根基。
`.trim(),
    },
  },

  creation_v20260517_1: {
    index: `
## 创建 Comment

任何 Object（含 user）都可创建评论。详见两个子节点：调用入口与系统自动填充字段。
`.trim(),

    entries_v20260517_1: {
      index: `
### 调用入口

- Object 通过 talkable 下 issue-discussion 相关的 server 方法
- user 通过后端 HTTP API：\`POST /api/sessions/{sid}/issues/{issueId}/comments\`
`.trim(),
    },

    autoFields_v20260517_1: {
      index: `
### 系统自动填充

- \`id\` —— 在所属 Issue 的 comments 内自增
- \`author\` —— 调用方上下文中的对象名
- \`createdAt\` —— 当前时间
`.trim(),
    },
  },

  mentions_v20260517_1: {
    index: `
## mentions 机制

\`mentions\` 是作者显式传入的对象列表，系统不从 content 自动解析 \`@name\`。
详见三个子节点：消息投递、前端渲染、participants 边界。
`.trim(),

    delivery_v20260517_1: {
      index: `
### 消息投递

mentions 中每个对象（剔除作者自身）通过 inbox 收到通知：

\`\`\`
[@you-name 在 issue-XXX 中提到你]
\`\`\`
`.trim(),
    },

    rendering_v20260517_1: {
      index: `
### 前端高亮

评论渲染时 \`@name\` 显示为可点击链接，点击跳转到对应 Object 的详情页。
`.trim(),
    },

    participantsBoundary_v20260517_1: {
      index: `
### 与 participants 的边界

被 @ 的对象**不会**自动加入 \`Issue.participants\`，避免被 @ 即被绑定到
长期跟踪列表。需要长期参与时由作者显式调用 updateIssue 添加。
`.trim(),
    },
  },

  sideEffects_v20260517_1: {
    index: `
## 副作用

创建评论时：

- 若 \`author !== "user"\` 且不在 \`issue.participants\` 中，作者被自动加入 participants
- \`issue.updatedAt\` 被刷新
- 触发 mentions 通知（见上）
`.trim(),
  },

  ordering_v20260517_1: {
    index: `
## 时序展示

前端按 \`createdAt\` 升序展示：

\`\`\`
2026-04-21 10:00 [alan]        @supervisor 我发现了一个问题...
2026-04-21 10:05 [supervisor]  @alan 能详细说说吗
2026-04-21 10:07 [user]        看起来是线程调度的 bug
\`\`\`

comments 不改写，时间戳客观可信。
`.trim(),
  },
};
