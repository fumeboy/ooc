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

1. 读 inbox 里 caller 的反思请求，理解它在业务 flow 里改了什么、想沉淀什么。
2. 在你的 self-view thread 上（投影 class = `super`）调下面的 **4 个分发 method** 一步到位
   把暂存改动按字段类型分别推进 canonical / pool。
3. 通过 creator talk_window 回复简短结论（say），用 `exec(method="end", args={ summary: "…" })` 收尾。

**不要只在 endSummary 里"嘴上沉淀"**——那下次的你看不到。一定要走下面的 4 method 让改动真的落盘。

## 写记忆（运行时即时沉淀，pool 通道）

`pools/<self>/knowledge/memory/<slug>.md`（slug 用 kebab-case，一条主题一文件）。
用 `exec(method="write_file", path=…, content=…)` 写，已存在用 open_file + edit。pool 写**不开 PR、立刻生效**——
下一轮 thread 由 frontmatter `activates_on` 命中即可读到。

### 记忆文件必须含 frontmatter（否则永远无法激活）

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

`activates_on` 是 `Record<trigger, "show_description" | "show_content">`,至少一项。trigger 三类：

| trigger | 含义 |
|---|---|
| `object::<type>` | 该 type 的 window open 时命中（`object::root` 每个 thread 都有 = 任何时候;`object::talk` 有对话窗时;`object::plan` 有计划窗时…）|
| `object_id::<id>` | 特定 objectId 的对象出现在 context 时命中（盯某个具体 peer / 成员）|
| `super` | 仅在 super flow 命中 |

`show_description` 命中露摘要,`show_content` 命中露全文;多 trigger 取 max。
**自检**：写完想一下"下次哪类 window 出现时我希望想起这条？"挑一个会真正出现在 context 里的
`object::<type>` 填进 activates_on,否则白写。

## 4 个反思 method —— 一步到位推改动进 canonical / pool

你在 super flow 的 self-view thread 上（投影 class = `super`，仅在 sessionId="super" 时
surface）直接拥有 4 个 object method。**禁止**绕过它们直写 `stones/main`——业务 session 内对 main
canonical 的直写会被 `resolveStoneIdentityRef` 守卫 throw `SuperSessionRequiredError`；只有这 4
method 内部通过受控 symbol 旁路合规放行。

1. **`scan_changes()`** —— 先扫描，看 caller 的业务 flow 内有哪些暂存改动，返回三组互斥清单：
   - `versioned_dirty`：版本化字段差异（class.versioned_fields 声明的，如 `agent.self`）—— 走 PR 通道。
   - `unversioned_dirty`：非版本化字段差异（其余 data 字段）—— 走 pool 通道。
   - `class_edits`：worktree 内 class 源码改动（`objects/<X>/executable/...` 等）—— 走 PR 通道。
2. **`create_pr_for_versioned(fields?, title)`** —— 对指定 versioned 字段（缺省 = 全部 dirty）一步开
   feat-branch PR：内部派生 feat 分支 worktree → 把字段值写入对应 stone 路径 → commit + diff +
   按改动路径算 reviewer → 落账 PR-Issue → 给每个 reviewer 投 pr_window。
3. **`sediment_unversioned(fields?)`** —— 对指定 unversioned 字段（缺省 = 全部 dirty）直写 pool
   （`pools/objects/<self>/data.json`，merge），**无 PR、立刻生效**。
4. **`create_pr_for_class_edits(paths?, title)`** —— 对指定 class 源码改动（缺省 = 全部）一步开
   feat-branch PR，流程同 method 2 但作用面是 class 源码而非字段值。

### 典型流程

```
exec(method="scan_changes")
  → 看清单，确认每组该不该推、要不要拆批次（按 fields/paths 子集传给后续 method 即可）

exec(method="sediment_unversioned")             # 全部 unversioned dirty 直接落 pool
exec(method="create_pr_for_versioned", args={ title: "为什么 / 沉淀什么" })   # 全部 versioned dirty 开一条 PR
exec(method="create_pr_for_class_edits", args={ title: "..." })               # 如有 class 源码改动
```

要点：

- 三组互斥（按字段是否 versioned + 是否 class 源码改动判），同一笔改动只走一个通道。
- PR reviewer 按 feat 分支 diff 路径所属对象（`objects/<X>/...` 顶层领地）算出；author 自己的子树
  不产生 reviewer；supervisor 恒在 reviewer 集。一票 reject 即驳回；全员 approve 后是自动合入还是
  人工确认由 `worldConfig.prAutoMerge`（缺省 false）决定。
- **被 reject / request-changes / 合入失败** → 一条 message 回投到你（super(foo)）的 thread，里面
  附了可逐字照抄的动作序列。照它走（再次调对应分发 method 续修），**不要用 curl / program 自查空转**。
- 不需要手动开分支、也不需要单独的 finalizer——PR 系 method 内部统一完成「派生 feat 分支 + 写
  入 + commit + 算 reviewer + 落账 PR」一条龙。

## 建 / 改对象

- 改**已存在**对象（自己或别人）的文件：在业务 session 编辑（write_file / file_window.edit），
  进 super flow 后用 4 method 推 canonical / pool。变更越出你自己子树（触及别人领地 / 新对象）
  → `create_pr_for_versioned` / `create_pr_for_class_edits` 算 reviewer 时自动把对应对象拉进 review,
  supervisor 恒在。
- 建**全新**对象：业务 session 用 `create_object`（原子建骨架，不能裸 write_file）。新对象在本 session
  内即可用，但 session 不合入 main——进 canonical 同样走 super flow 的 PR 分发 method。
- **新对象（仅 session 内、尚未 canonical）想 `talk(super)` 沉淀自己**：它自己还不在 main、当不了 PR 作者，
  所以这条 super flow 由它**最近的 canonical 祖先**代为发起（顶层新对象没有路径 parent → 由 supervisor 代发）。
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
