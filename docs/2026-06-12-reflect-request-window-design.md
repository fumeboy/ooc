# reflect_request window —— reflectable 在 core 的具体落脚点（设计）

> 状态：**设计已收敛（2026-06-12 用户逐步拍板），待开工**。基准源码逐锚核实。
> 关联：`docs/2026-06-11-reflectable-feat-branch-pr-flow-design.md`（feat-branch PR 沉淀模型，本设计不改其语义，只给 reflectable 一张"前门"并改一个方法名）。

## 0. 收敛后的设计（三句话）

1. **保留 `pr` window 不动**（reviewer 评审面：`approve`/`reject`/`request_changes` + PR DetailView）。
2. **新增 `reflect_request` window class**：super flow 反思 thread 的**会话面**（取代 creator talk_window），并**挂载沉淀方法** `new_feat_branch` + `create_pr_and_invite_reviewers`。它是 reflectable 在 core 里可指认的前门。
3. **`evolve_self` 改名 `create_pr_and_invite_reviewers`**（名副其实的 finalizer）。

> 两个 class、各挂各的方法、永不在同一 thread 共存 → 无交叉 surface、无需 role/issueId 过滤、**无需 `for_reflectable` flag**（前几轮讨论的 flag 被本形态取代：方法挂 reflect_request → window 在场即 super-flow 闸）。

## 1. 动机

reflectable 在 core 里**没有一张脸**，三个互相印证的问题：

1. **没有前门**：reflectable 是 talk-delivery / stone / pool / knowledge 在 super session 下的协同，emergent 但无可指认实体。
2. **方法归属错位（smell A）**：`new_feat_branch`/`evolve_self` 挂 `root`（`builtins/root/executable/index.ts:48-49`），`getOpenableMethods()` 无条件全列 + root window 恒在 → 业务 session 也 surface，靠 exec 内 `isSuperSessionId` 运行时拒绝。存在性≠有效性。
3. **方法名不诚实**：`evolve_self` 听起来像"自我进化"，实际只是"commit + 开 PR + 邀请 reviewer"，且合入前并不 evolve。

## 2. 机制真相（设计据此而立，已核实）

- **F1 方法菜单 per-window 渲染**（`thinkable/context/renderers/xml.ts:79` `renderMethodsNode`）：对每个在场 window 取 `def.methods ∪ def.windowMethods` 展示。**一个方法只在它所属 class 的 window 在 `thread.contextWindows` 里时才 surface。** → 把沉淀方法挂到 reflect_request class，则只在 reflect_request 在场（= super flow 反思 thread）时 surface，**这就是 smell A 的正解，且不需任何额外 flag**。
- **F2 下放零侵入**：`new_feat_branch`/`evolve_self` 的 exec **只读 `ctx.thread`、不读 `ctx.self`**（class-agnostic，`method.new-feat-branch.ts:60` / `method.evolve-self.ts:50`）。从 root 改挂到 reflect_request class 仅改注册键，exec 体零改。
- **F3 author 与 reviewer 是不同 thread 的不同 window**：author = super(foo) 反思 thread（有 reflect_request）；reviewer = `t_prreview_<reviewer>_<id>` thread（有 pr）。两个 window class **永不共存于同一 thread** → 天然零交叉 surface。**author 根本收不到 pr**（`computeReviewerSet` 排除 author 子树，`stone-feat-branch.ts:96/99`）。
- **F4 RenderContext 只有 `{thread, window}`**（`registry.ts:24`）——reflect_request 会话渲染所需身份从 `ctx.thread.persistence`（objectId/sessionId）取，与 talk 一致。

## 3. reflect_request = 会话面 + 沉淀方法

reflect_request 在 super flow 取代 creator talk_window 作会话面，**必须无损继承 talk 的对话 + 回报 caller**（grounding 已核实，缺一不可）：

- **会话渲染**：复用 talk 的 transcript 渲染 + 消息过滤（`talk/index.ts:56` `renderTalkWindow` / `:43` `filterMessagesForTalkWindow`），渲染 caller↔super(foo) 对话。
- **回报 caller 双通道**：① 反思 thread `end({result})`/主动 say → creator window 自动代发（`method.end.ts:58` `autoReplyTalk`）→ `delivery.ts:104` `crossSessionCreatorReply` 跨 session 派回 caller 业务 session；② `worker.ts:260` `syncCrossObjectCalleeEnds` 兜底扫 callee done/failed 注 caller inbox。两条 callee 解析（`resolveSuperActor`+session=super）须严格一致。
- **不可 close**（恒在通道，沿用 creator talk_window 的 `onCloseTalkWindow` 拒关语义 `talk/index.ts:167`）。
- **挂载方法**：`new_feat_branch` + `create_pr_and_invite_reviewers`（window method，class-agnostic exec，F2）。会话 `say`/`wait` 复用 talk 机制。
- **物理形态**：`isBuiltinFeature:true`，inline 进 thread-context.json（同 talk/pr，无独立 dir）。

触发入口：仍用 `talk(target="super")` 自指别名（`delivery.ts:88`），在 super-alias 派送分支里**把注入的 creator window 由 `class:talk` 改成 `class:reflect_request`**（`_shared/init.ts:55/125` creatorWindow 构造处）。`talkConstructor` 对 super 跳过目录校验的豁免（`talk/index.ts:234`）保留。

## 4. 沉淀状态机（reflect_request 是脸，存储不动）

reflect_request 渲染/驱动既有存储，**不引入新存储实体**：

```
reflect_request（super(foo) 反思 thread，会话面）
  │  对话 say/wait（回报 caller）
  ├─ pool sediment 旁路：write_file 写 pools/… → write-through 立即 canonical，永不开 PR
  └─ draft ── new_feat_branch（绑 thread.persistence.stonesBranch）+ write_file 编辑 feat worktree
        └─ create_pr_and_invite_reviewers ──→ createPrIssue + 投递 pr_window 给各 reviewer
                                                  │
pr window（每个 reviewer 的 pr-review thread）──── approve/reject/request_changes
                                                  ├─ ready-to-merge ─(prAutoMerge 闸)→ merged
                                                  ├─ rejected / changes-requested
                                                  └─→ repair：routePrRepairMessage 回投 reflect_request → 回 draft 续修
```

**pool-only 旁路**（`file/executable/index.ts:284` `classifyPackagesPath`）：同一 `write_file` 按路径前缀分流——`stones/main/objects/<id>/…`→worktree+PR；`pools/…`→write-through、立即生效、不开 PR。reflect_request 不能假设"有 reflect_request = 一定开 PR"；纯 pool 沉淀的 `create_pr_and_invite_reviewers` 遇空 worktree 报 `NO_CHANGES`（`stone-feat-branch.ts:269`）。

## 5. 方法改名 `evolve_self` → `create_pr_and_invite_reviewers`

名副其实：它就是 commit feat worktree → 算 reviewer 集 → createPrIssue → 投递 pr_window。**一次改全**（半改即漂移）：

- 源码：`method.evolve-self.ts`（文件名 → `method.create-pr-and-invite-reviewers.ts`）、`evolveSelfMethod`/`executeEvolveSelf` 符号、注册键 `evolve_self`、`intents:["evolve_self"]`、`approval-flow.ts:76` 回修动作块字符串、`exec.ts:52` hint 列举、storybook stories（`reflectable.story.ts:114` exec 匹配 + 各 L4/L6 描述）。约 33 源码文件含引用（多数 prose）。
- builtin knowledge（9）：`self-evolution.md`/`super-flow.md`/`pr-review.md` 等正文。
- 对象树（20）：reflectable `self.md`/`feat-branch-pr.md`/`super-flow.md`、persistable、programmable 等。
- docs（32）：本 spec + `2026-06-11-...` 等。

> 配套：`new_feat_branch` 名保留（开分支语义清晰）；两者构成 `new_feat_branch`（开）→ `create_pr_and_invite_reviewers`（收）的沉淀对。

## 6. 坚决不搬：persistable 存储层

reflect_request 是 **executable 维度的交互面（一张脸）**，下列**留原处不动**，只渲染/驱动、绝不吸收——否则 god-window 变 god-object：

- `persistable/pr-issue.ts`（`PrIssueRecord`/`aggregatePrApproval`/`approvePrIssue`）、`stone-feat-branch.ts`（`createFeatBranchWorktree`/`commitAndOpenPr`/`computeReviewerSet`）、`stone-versioning.ts`（`resolvePrIssue`）、`super-actor.ts`（`resolveSuperActor`）、`world-config.ts`（`prAutoMerge`）。
- `thread.persistence` 的 feat 绑定（`stonesBranch`/`sedimentIntent`）——沉淀状态机寄居 thread-local，**不搬进 window 字段**。
- 评审编排单点 `approval-flow.ts:103` `applyPrApproval`（pr method + HTTP approve 同源委托）。
- **pr window 保留不动**（本设计明确不动 reviewer 评审面）。

reflect_request 拥有的只是：新 window class 注册（会话 readable + onClose + 两个沉淀 method）。

## 7. 迁移计划（分阶段，每阶段可独立验）

1. **P1 改名 `evolve_self` → `create_pr_and_invite_reviewers`**（全表面一次改全：源码符号/键/intents/文件名 + builtin knowledge + 对象树 + docs + tests）。独立、纯机械、可单测回归。
2. **P2 新增 `reflect_request` window class**：会话 readable（复用 talk 渲染）+ onClose 拒关 + 挂 `new_feat_branch`/`create_pr_and_invite_reviewers`（从 `ROOT_METHODS` 移出，F2 零侵入）；`isBuiltinFeature:true`。沉淀知识 `self-evolution.md` 的 `activates_on` 从 `object::root` 改 `object::reflect_request`。
3. **P3 super flow 注入 reflect_request 作会话面**：`talk/delivery.ts` super-alias 派送分支 + `_shared/init.ts` creatorWindow 构造，把 super 反思 thread 的 creator window 由 `class:talk` 改 `class:reflect_request`（继承对话 + 回报双通道 §3）。
4. **P4 文档回流**：reflectable `self.md` 的"不是新机制是协同"改写为"协同由 reflect_request 这扇门统起来（前门在 core、机制仍分布 persistable/thinkable）"；对象树 `super-flow.md` 把 creator talk_window 表述改 reflect_request。

> `for_reflectable` flag **不实施**（被本形态取代：方法挂 reflect_request、window 在场即 super-flow 闸）。

## 8. 开放问题 / 待拍板

1. **会话复用粒度**：reflect_request 的会话 readable/say/wait 是**复用 talk 的实现**（共享 `renderTalkWindow`/`deliverTalkMessage` 等内部）还是**独立实现**？倾向复用（super flow 会话本质=带 super 语义的 talk），把 reflect_request 做成"talk + 2 方法 + super 注入"。需确认 talk 内部可被干净复用而不耦合。
2. **smell B（惰性 feat 分支）**：是否顺带让 `new_feat_branch` 惰性化（首次写 stone 即懒建分支），只留 `create_pr_and_invite_reviewers`？与本设计正交，可延后。
3. **`reflect_request` 命名**：对"纯对话/pool sediment"两态略宽（它们不一定产生"request"）。可接受，或考虑 `reflection`。次要。
4. **pr 历史债**：`pr-issue.ts` 顶部警告"PR-Issue ≠ 已移除的 issue 看板"——勿把看板概念搬回。

## 9. 锚点附录（实施据此，行号会漂、优先核符号名）

- 方法 per-window surface：`thinkable/context/renderers/xml.ts:79` `renderMethodsNode`（self 菜单当前不过滤）
- window class 注册：`runtime/object-registry.ts:112` `registerExecutable` / `:127` `registerReadable` / `:152` `assertNoMethodNameCollision`；`isBuiltinFeature` inline `_shared/window-persistence.ts:62`
- pr window（保留）：`executable/windows/pr/index.ts`（`:166` 注册 / `:29` `renderPrWindow` / `:87` `onClosePrWindow`）、`pr/delivery.ts:81` `deliverPrWindowToReviewers`
- talk 会话（reflect_request 复用）：`talk/index.ts:56` `renderTalkWindow` / `:43` `filterMessagesForTalkWindow` / `:167` `onCloseTalkWindow` / `:279/289` 注册、`talk/delivery.ts:88` super-alias / `:104` `crossSessionCreatorReply`
- creator window 注入（改注 reflect_request）：`_shared/init.ts:55` `isCreatorSelf` / `:125` creatorWindow 构造
- 回报兜底：`app/server/runtime/worker.ts:260` `syncCrossObjectCalleeEnds`
- 沉淀方法（移出 root → reflect_request，并改名 evolve_self）：`builtins/root/executable/index.ts:48-49`、`method.new-feat-branch.ts:60`、`method.evolve-self.ts:50`
- feat 绑定：`_shared/types/thread.ts:52/54`、`stone-worktree.ts:169/179`
- pool/stone 分叉：`file/executable/index.ts:284` `classifyPackagesPath`、`stone-feat-branch.ts:269` `NO_CHANGES`
- 评审编排单点（不动）：`approval-flow.ts:103` `applyPrApproval`；多-thread 调度 dedup 含 threadId：`app/server/runtime/job-manager.ts:16`
