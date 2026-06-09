# Storybook Stories 大纲 —— 单元化能力预期目录

> 把 storybook 从「9 个能力大 story」细化为**很多条单元化 story**：每条对应**一个简单、稳定、确定性的预期**
> （≤100 字），并标注它**锚定的 OOC 设计**。Tier A（控制面，零真 LLM，进 CI gate）。
> 实现：`packages/@ooc/storybook/stories/L<n>_<layer>.stories.ts`，由 `stories/_catalog.ts` 聚合、
> `stories/_catalog.test.ts`（bun:test）逐条收为一个 `it`。
>
> 事实来源：HTTP 端点全集（`app/server/modules/*/api.*.ts`）+ 运行时磁盘布局（`persistable/*`，方案 A
> session-worktree 统一模型）。每条 story 的 `design` 字段锚 `file:行号`。

设计哲学：OOC 的每个设计点都简单稳定；把它们各自钉成一条预期，组合起来就守住了系统的全貌。
一条 story 只断**一个**预期；setup 廉价（每条 story 独立 `mkServer`，相互隔离）。

---

## L0 — World 子树 / Persistable 落点

承载「身份/事实/产物落到 stone(持久+git) / pool(持久+不git) / flow(运行层) 三子树」。

- **L0-STONE-REPO** — ensureStoneRepo 后 `stones/main/` 是 git 仓库（worktree link 存在）〔persistable: bootstrap stones/main〕
- **L0-CREATE-STONE** — 建对象后 `stones/main/objects/<id>/` 出现 package.json + self.md〔create-stone.ts〕
- **L0-STONE-GIT** — 建对象的 self.md 进 git（`git log` ≥1 commit）〔versioning: stone identity tracked〕
- **L0-SELF-COMMIT** — 经 HTTP PUT 改 self 在 stones/main 多出一个 commit（可审计可回滚）〔put-self.ts〕
- **L0-POOL-NOGIT** — 建对象同时建 `pools/<id>/` 骨架，且 pool 不进 git〔pool-object.ts〕
- **L0-THREE-SUBTREES** — 一次操作后 stone/pool/flow 三子树各就位、互不混淆〔persistable 三子树分离〕
- **L0-GITIGNORE** — stones/main/.gitignore 白名单 objects/、黑名单运行时（threads/ / state.json / .flow.json）〔bootstrap.ts gitignore〕

## L1 — Session / Flow 生命周期（worktree 模型）

承载「session 身份 = 从 stones/main 派生的 lazy/eager git worktree」。

- **L1-SESSION-DIR** — 发起 session 后 `flows/<sid>/` 目录出现〔seed-session.ts〕
- **L1-SESSION-WORKTREE** — `flows/<sid>/` 是 stones/main 派生的 git worktree（.git link + 分支 session-<sid>）〔stone-worktree.ts:ensureSessionWorktree〕
- **L1-SESSION-META** — `flows/<sid>/.session.json` 存在且记 sessionId〔flow-object.ts:createFlowSession〕
- **L1-THREAD-JSON** — 和某对象会话后 `flows/<sid>/objects/<oid>/threads/<tid>/thread.json` 出现〔thread-json.ts:writeThread〕
- **L1-THREAD-CONTEXT** — 同一 thread 下 thread-context.json 出现（contextWindows 唯一权威）〔flow-thread-context.ts〕
- **L1-THREAD-NO-WINDOWS** — thread.json **不含** contextWindows 字段（§10 退役，单点权威分离）〔thread-json.ts §10〕
- **L1-SUPER-NO-WORKTREE** — 控制面 super session 不建 worktree（flows/super 无 .git）〔super flow 直 main〕
- **L1-SEED-RESPONSE** — POST /api/sessions 返回 sessionId（+ targetThreadId/jobId）〔seed-session.ts〕
- **L1-WORKTREE-GITIGNORE** — session worktree 继承 main 的 .gitignore，运行时产物不进 git〔worktree 继承〕

## L2 — Thinkable（上下文 / 知识 / thread）

承载「LLM 看到的是一组 ContextWindow 对象 + 沿 stone/pool 加载的 knowledge」。

- **L2-KNOWLEDGE-INDEX** — 对象的 knowledge/*.md 经 loadKnowledgeIndex 可加载进索引〔knowledge/loader〕
- **L2-ROOT-KNOWLEDGE** — root window 协议知识（ROOT_KNOWLEDGE）列出可用 root method〔root/executable〕
- **L2-CONTEXT-WINDOW-TYPES** — 已注册 ObjectType 经 /api/windows/_shared/types 暴露 type + methods〔api.list-window-types〕
- **L2-KNOWLEDGE-INHERIT** — instance 经 class 链继承框架 class 的 seed knowledge〔loader + parentClass 链〕
- **L2-POOL-KNOWLEDGE** — pool 知识（pools/<id>/knowledge）与 stone 知识合并进同一索引〔loader stone+pool〕

## L3 — Executable（方法 / registry 维度劈分 / tool 原语）

承载「Object = 数据字段 + 程序方法；executable 与 readable 两维度分注册」。

- **L3-REG-EXECUTABLE** — registerExecutable 只注册 object methods + 类元（parentClass/isBuiltinFeature）〔object-registry.ts:registerExecutable〕
- **L3-REG-READABLE** — registerReadable 只注册 readable 维度（readable/windowMethods/compressView/...）〔object-registry.ts:registerReadable〕
- **L3-METHOD-COLLISION** — 同一 type 上 object method 与 window method 同名 → 注册期 fail-loud〔assertNoMethodNameCollision〕
- **L3-FILE-WINDOWMETHOD** — builtin file 的 set_viewport 是 windowMethod，不在 object methods 表〔file/readable.ts〕
- **L3-UI-METHOD-CALL** — Object 的 ui_methods 经 HTTP /call_method 执行并返回结果〔api.call-method〕
- **L3-WINDOW-COMMAND-LOAD** — Object 的 window.methods（LLM 路径命令）经 loadObjectWindow 可加载〔server-loader〕
- **L3-CONSTRUCTOR-LOOKUP** — kind=constructor 的 method 经 lookupConstructor 命中〔object-registry.ts:lookupConstructor〕
- **L3-PARENTCLASS-CHAIN** — 未注册 type 经 parentClass 链回退解析 method（缺省继承 root）〔resolveMethod 链〕

## L4 — Collaborable（talk / do / Issue / relation）

承载「Object 间通过 talk_window / do_window / Issue 协作」。

- **L4-USER-TALK** — seedSession 在 user.root 上建对 target 的 talk_window〔api.add-user-talk-window / seed〕
- **L4-CONTINUE-INBOX** — continue 投递消息进 callee 的 inbox（inbox/msg_<id>.json）〔continue-thread + persistInboxMessages〕
- **L4-TALK-WINDOW-TYPE** — talk window 是 isBuiltinFeature（inline 进 thread-context，不写独立 dir）〔windows/talk〕
- **L4-CROSS-OBJECT-TALK** — 跨对象 talk 在双方 session 各落 thread〔collaborable cross-object〕
- **L4-PR-ISSUE-FILE** — cross-scope evolve 越界 → flows/super/issues/issue-<id>.json 出现〔pr-issue.ts〕
- **L4-RELATION-POOL** — relation window 落 pools/<id>/knowledge/relations/<peer>.md〔pool relations〕

## L5 — Observable（debug / activity / pause）

承载「过程可观测：LlmObservation / debug 落盘 / pause / activity 快照」。

- **L5-DEBUG-TOGGLE** — debug enable 后 /api/runtime/debug/status 返回 enabled=true〔api.enable-debug / get-debug-status〕
- **L5-DEBUG-SNAPSHOT** — 跑一轮 thread 后 debug/llm.input.json + llm.output.json 落盘〔debug-file.ts〕
- **L5-LOOP-DEBUG** — 多轮 loop 各自落 loop_<N>.{input,output,meta}.json〔api.list-loop-debug〕
- **L5-ACTIVITY** — /api/runtime/activity 返回 now/runningCount/jobs 结构〔api.activity〕
- **L5-GLOBAL-PAUSE** — global-pause enable→status enabled，disable→status disabled〔api.*-global-pause〕
- **L5-JOB-STATUS** — 入队 job 经 /api/runtime/jobs/:id 可查 status〔api.get-job〕

## L6 — Reflectable（super flow / evolve_self / memory）

承载「自我迭代：业务 session 试验 → super flow evolve_self 合入 main」。

- **L6-WORKTREE-WRITE** — 业务 session 改自身 self 落 flows/<sid>/ worktree，stones/main canonical 不变〔file write_file worktree 重定向〕
- **L6-EVOLVE-FFMERGE** — evolve_self self-scope → ff-merge 回 main，留署名 commit〔evolve-self.ts:tryMergeSelf〕
- **L6-EVOLVE-CROSS-PR** — evolve_self cross-scope（改/建别人对象）→ 开 PR-Issue 待评审〔evolve-self.ts cross-scope〕
- **L6-MEMORY-POOL** — long memory 落 pools/<id>/knowledge/memory/<slug>.md〔reflectable memory〕
- **L6-CREATE-OBJECT-WORKTREE** — create_object 在业务 session 落 session worktree objects/<newId>/（未即合入 main）〔stone-create-object.ts〕

## L7 — Programmable（server 方法 / 热更）

承载「Object 为自己写 executable/server 方法，运行时热更」。

- **L7-EXEC-HOTRELOAD** — 写 executable/index.ts 后 loadObjectWindow 加载到新 method〔server-loader 热更〕
- **L7-UI-METHOD-HOTRELOAD** — 改 ui_methods 后 /call_method 反映新逻辑（fs.watch ~350ms）〔hot reload〕
- **L7-SERVER-SOURCE-RW** — PUT/GET /api/stones/:id/server-source 读写一致〔api.put/get-server-source〕

## L8 — Visible（client / ooc:// / SPA route）

承载「Object 为自己写 client 界面；ooc:// 原生寻址由 visible 渲染层 1:1 映射 SPA route」。

- **L8-CLIENT-URL-STONE** — stone scope client-source-url 指向 visible/index.tsx（单页）〔api.client-source-url〕
- **L8-CLIENT-URL-FLOW** — flow scope client-source-url 指向 client/pages/:page.tsx（多页）〔api.client-source-url〕
- **L8-TYPES-CATALOG** — /api/objects/_shared/types 列出全部已注册 type〔api.list-window-types 别名〕
- **L8-WORLD-CONFIG** — /api/world/config 返回 siteName 等 world 级配置〔world-config〕

## L9 — Class（一等继承抽象）

承载「class 与 object 平级、不可交互、仅供继承；builtin=class、world=object 实例」。

- **L9-INSTANTIATE** — instantiate 把 supervisor class 实例化为 objects/supervisor（拷 self.md + ooc.class）〔instantiate-classes〕
- **L9-INSTANTIATE-IDEMPOTENT** — 二次 bootstrap 跳过已存在 instance、保用户改动〔instantiate-classes 幂等〕
- **L9-CLASS-NOT-USER** — user 是被动对象，不被实例化为可交互 instance〔instantiate 排除 user〕
- **L9-CLASS-NONINTERACTIVE** — seedSession 拒绝 `_builtin/` class 作为对话目标（400）〔seed-session 校验〕
- **L9-CLASS-INHERIT-KNOWLEDGE** — instance 经 class 链继承框架 class seed knowledge〔同 L2-KNOWLEDGE-INHERIT〕

---

## 实现进度

- [x] 大纲（本文件）
- [x] 新骨架 `_harness/story.ts`（Story 类型 + check + skip + gate）+ `stories/_catalog.test.ts`（gate）+ `catalog-runner.ts`（审计报告）
- [x] L0–L9 全部补全（56 条）
- [x] 执行一轮 → `docs/ooc-6/storybook/stories-report.md`（45 PASS / 0 FAIL / 11 SKIP）

> **0 FAIL 怎么读**：不代表「OOC 无缺陷」，只代表**所有控制面可确定性验证的预期都成立**——
> 我按已核实的端点/磁盘布局如实写预期、未为绿调参。真正的「设计 vs 实现」差异前沿在 11 条 SKIP
> （需 worker/真 LLM/live Vite，归 Tier B / e2e）+ 尚未想到要写的预期。若你怀疑某设计点实现有偏差，
> 把它写成一条预期加进 catalog 跑，FAIL 即差异。
>
> 迁移：新「单元化 catalog」是 Tier A 的主力；既有 `stories/<cap>.story.ts` 的 Tier B agent-native 保留。
> 旧 `<cap>.story.ts` 的 Tier A TC 随对应层补全后逐步退役（避免重复覆盖）。
