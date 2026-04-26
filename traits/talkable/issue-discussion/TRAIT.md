---
namespace: kernel
name: talkable/issue-discussion
type: how_to_think
version: 1.0.0
when: never
activates_on:
  paths: ["talk", "talk_sync"]
description: Issue 讨论能力，所有对象可通过此 trait 参与 issue 评论
deps: []
---

# Issue 讨论

你可以参与 Session 中的 Issue 讨论。

## 可用方法

- `commentOnIssue(issueId, content, mentions?)` — 发表评论，可 @其他对象
- `listIssueComments(issueId)` — 读取评论列表
- `getIssue(issueId)` — 读取 issue 详情

## 讨论原则

- 收到 issue 讨论邀请时，先用 `getIssue()` 阅读 issue 描述和已有评论
- 发表评论要有明确立场和论据，不要空泛回复
- 如果需要其他对象的意见，在 mentions 中 @他们
