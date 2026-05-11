import { kanban_v20260506_1 } from "@meta/object/collaborable/kanban/index.doc";

export const comment_v20260506_1 = {
    get parent() { return kanban_v20260506_1; },
    index: `
Comment 是 Issue 下的评论。一旦创建，**不可修改**——
行动记录不可变是 OOC 的基本约束。

## 数据结构

\`\`\`typescript
interface Comment {
  id: string;                       // 自增，如 "comment-001"
  author: string;                   // Object 名（或 "user" 表示人类）
  content: string;                  // markdown
  mentions?: string[];              // 显式列出的 @ 对象名列表
  createdAt: string;                // ISO 时间戳
}
\`\`\`

存储位置：在 \`flows/{sid}/issues/{issueId}.json\` 的 \`comments\` 数组里
（同时镜像到 \`flows/{sid}/issues/index.json\` 中对应 Issue 的 comments 字段）。

## 不可变性

**Comment 没有 updatedAt 字段**——一旦创建就不能改写。

需要纠正时，发新 comment 说明，旧 comment 保留不变。
让 Issue 讨论历史**完整可追溯**——不会发生"原本说了 A，后来改成了 B，读者以为一直是 B"。

## 创建 Comment

任何 Object（含 user）都可创建评论。

- Object 通过 talkable 下 issue-discussion 相关的 server 方法
- user 通过后端 HTTP API：\`POST /api/sessions/{sid}/issues/{issueId}/comments\`

系统自动填：
- \`id\` —— 在所属 Issue 的 comments 内自增
- \`author\` —— 调用方上下文中的对象名
- \`createdAt\` —— 当前时间

## mentions 机制

\`mentions\` 是作者**显式**传入的对象列表（系统不会从 content 里自动解析 \`@name\`）。

效果：

1. **消息投递**：mentions 中的每个对象（已剔除作者自身）通过 inbox 收到通知
   消息形如 \`[@you-name 在 issue-XXX 中提到你]\`
2. **前端高亮**：评论渲染时 \`@name\` 显示为可点击链接

注意：被 @ 的对象**不会**自动加入 Issue.participants（只有作者会）——
避免被 @ 即被绑定到 Issue 长期跟踪列表。

## 副作用

创建评论时：
- 若 \`author !== "user"\` 且不在 \`issue.participants\` 中，作者被自动加入 participants
- \`issue.updatedAt\` 被刷新
- 触发 mentions 通知（见上）

## 时序展示

前端按 \`createdAt\` 升序展示：

\`\`\`
2026-04-21 10:00 [alan]        @supervisor 我发现了一个问题...
2026-04-21 10:05 [supervisor]  @alan 能详细说说吗
2026-04-21 10:07 [user]        看起来是线程调度的 bug
\`\`\`

时序不变——comments 不改写，时间戳客观可信。

## 为什么不允许修改

### 诚实

如果允许修改，对象（或人类）可能在事后美化自己说过的话。
不可变让历史是**客观事实**。

### 反思素材的真实性

反思机制需要真实的历史作为素材（详见 reflectable）。
如果评论可改，就没有"真实的历史"——只有"当前想让人相信的历史"，
反思就失去了根基。
`,
};
