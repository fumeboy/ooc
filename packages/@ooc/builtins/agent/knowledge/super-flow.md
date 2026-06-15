---
title: 你正在 super flow（反思 / 沉淀 / 合入）
description: super flow 是你的反思通道：沉淀记忆、合入身份演化、（supervisor）治理
activates_on:
  "super": "show_content"
---

当前 thread 跑在你的 super flow（sessionId="super"）里。这是反思通道——沉淀经验、合入身份
演化，不是执行新业务任务。你仍是同一个 Object（system context 顶部 `<self object_id>` 就是你），
super flow 只是同一身份的另一条会话脉络。

## 本轮该做什么

1. 读 inbox 里 caller 的反思请求，理解要沉淀 / 调整什么。
2. **写记忆**到 `pools/<self>/knowledge/memory/<slug>.md`（slug 用 kebab-case，一条主题一文件）。
   用 `exec(method="write_file", path=…, content=…)` 写，已存在用 open_file + edit。
3. 通过 creator talk_window 回复简短结论（say），用 `exec(method="end", args={ summary: "…" })` 收尾。

**不要只在 endSummary 里"嘴上沉淀"**——那下次的你看不到。一定要 write_file 到 memory 目录。

## 记忆文件必须含 frontmatter（否则永远无法激活）

没有 frontmatter 的 .md 会被加载但永远不命中——下轮新 thread 完全看不到你的沉淀。每篇必填：

```markdown
---
title: <一句话主题>
description: <一句话让下轮 LLM 判断是否相关>
activates_on:
  "<trigger>": "show_description"
  "<trigger>": "show_content"
---

<正文>
```

`activates_on` 是 `Record<trigger, "show_description" | "show_content">`，至少一项。trigger 三类：

| trigger | 含义 |
|---|---|
| `object::<type>` | 该 type 的 window open 时命中（`object::root` 每个 thread 都有 = 任何时候；`object::talk` 有对话窗时；`object::plan` 有计划窗时…）|
| `object_id::<id>` | 特定 objectId 的对象出现在 context 时命中（盯某个具体 peer / 成员）|
| `super` | 仅在 super flow 命中 |

`show_description` 命中露摘要，`show_content` 命中露全文；多 trigger 取 max。
**自检**：写完想一下"下次哪类 window 出现时我希望想起这条？"挑一个会真正出现在 context 里的
`object::<type>` 填进 activates_on，否则白写。

## 沉淀身份/身体进 canonical：feat 分支 PR

业务 session 里 write_file 改 self.md / readable / executable / visible / seed knowledge 只在那个
session 试验——`session-<sid>` worktree 是运行时派生物，**永不合入 main**。要让身份/身体改动进
canonical 权威自我，在 super flow 里走一条 **feat 分支 PR**（每次沉淀一个独立单元）：

```
exec(method="new_feat_branch", args={ intent: "为什么/沉淀什么" })   # 从 main 派生 feat 分支并绑定本 thread
exec(method="write_file", args={ path: "stones/<self>/self.md", content: … })  # 直接编辑 feat 分支下文件
…（write_file / open_file+edit ×N，落 feat worktree，不是 session、不是 main）…
exec(method="create_pr_and_invite_reviewers")                                          # finalizer：commit feat 分支 + 开 PR
```

要点：
- `new_feat_branch` 绑定后，你普通的 `write_file` / `file_window.edit` 就**直接落 feat 分支 worktree**
  （`stones/<id>/...` 路径自动路由过去）——这是 super flow 里唯一直接编辑 stone 身体的入口。
- `create_pr_and_invite_reviewers` 是 **finalizer，无内容参数**（intent 可选，缺省沿用 new_feat_branch 的）：它 commit 你
  在 feat 分支上的编辑（署名你）→ 按变更触及谁的领地算出 reviewer 集 → 开 PR → 给每个 reviewer 投
  pr_window。**忘了先 new_feat_branch 直接 create_pr_and_invite_reviewers 会失败**（fail-loud 提示先开分支）。
- reviewer（含 supervisor，始终参与）在各自 thread 看到 pr_window，approve / reject / request_changes
  （评审协议见 pr-review 知识）。全 approve → 按 `.world.json prAutoMerge` 合入（缺省 false=人工确认）。
- **被 reject / request-changes / 合入失败** → 一条 message 回投到你（super(foo)）的 thread，里面附了
  可逐字照抄的动作序列。照它走，**不要用 curl / program 自查空转**：
  1. `exec(method="new_feat_branch", args={ intent: "<message 里给的原 intent>" })` —— 同 intent 幂等重绑同一 feat 分支续修。
  2. `write_file` / `file_window.edit` 按反馈改 stone 路径（`stones/<self>/...`）。
  3. `exec(method="create_pr_and_invite_reviewers")` —— 重开/更新 PR 交 review。

## 建 / 改对象

- 改**已存在**对象（自己或别人）的文件：在上面的 feat 分支上 write_file 即可。变更越出你自己子树
  （触及别人领地 / 新对象）→ `create_pr_and_invite_reviewers` 算 reviewer 时自动把对应对象拉进 review，supervisor 恒在。
- 建**全新**对象：业务 session 用 `create_object`（原子建骨架，不能裸 write_file）。新对象在本 session
  内即可用，但 session 不合入 main——进 canonical 同样走 feat 分支 PR（在 super flow 把新对象目录纳入 feat
  分支后 create_pr_and_invite_reviewers）。
- **新对象（仅 session 内、尚未 canonical）想 `talk(super)` 沉淀自己**：它自己还不在 main、当不了 PR 作者，
  所以这条 super flow 由它**最近的 canonical 祖先**代为发起（顶层新对象没有路径 parent → 由 supervisor 代发）。
  即：祖先在 super flow 里 `new_feat_branch` → 把新对象目录写进 feat 分支 → `create_pr_and_invite_reviewers` 开 PR 把它的首版沉淀进 main。
  你不必关心这层路由——照常 `talk(super)` 即可，系统自动选好代发者。

## supervisor 专属（你不是 supervisor 时跳过）

PR 治理经控制面 HTTP 端点（reviewer 也可在自己 pr_window 上用 approve/reject/request_changes method）：

```
GET  /api/runtime/pr-issues                      # 列出待审 PR（带 reviewers/approvals/verdict）
GET  /api/runtime/pr-issues/<N>                  # 看某条 PR 全量（intent/diff/paths）
POST /api/runtime/pr-issues/<N>/approve          # body { reviewerObjectId, decision: "approve"|"reject"|"request-changes" }
POST /api/runtime/pr-issues/<N>/resolve          # body { decision: "merge"|"reject"|"request-changes" }（prAutoMerge=false 时人工落锤合入）
```

回滚某对象 stone 历史：`POST /api/runtime/stones/<id>/rollback`，body `{ targetCommit: "<sha>" }`。
