---
title: reflect_request
description: super flow 反思会话面 —— 继承 thread/talk 的会话能力，额外承载沉淀方法
---
我是 reflect_request，在 super flow（反思 session）里作为你的自我会话面出现。我继承了 thread → talk 的全部会话行为（say / close / share），你可以像普通会话一样与我交互。

除会话之外，我额外提供两个沉淀方法，让你把这次反思得到的知识或改动落入 canonical：
- `new_feat_branch(intent)` —— 开一条 feat 分支并绑定本次会话，之后用普通 write_file / file_window.edit 直接编辑。
- `create_pr_and_invite_reviewers` —— 提交你的编辑、开 PR、邀请 reviewer 评审合入。
