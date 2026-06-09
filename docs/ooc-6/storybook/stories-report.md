# Storybook Stories 执行报告（单元化 Tier A）

> catalog-runner 产物（自动生成）。每条 story = 一个简单稳定预期；本报告记录其在控制面（零真 LLM）下的三态。
> 生成：`bun run packages/@ooc/meta/storybook/catalog-runner.ts`。大纲：`stories-outline.md`。

**汇总**：56 条 · 🟢 PASS 45 · 🔴 FAIL 0 · ⬜ SKIP 11

- **PASS**：控制面确定性验证通过——该 OOC 设计点按预期工作。
- **FAIL**：预期与实现有**差异**，待人裁决（改实现 or 改预期）。
- **SKIP**：该预期控制面不可确定性验证（需 worker/真 LLM/live Vite），归 Tier B / e2e。

## persistable

| 状态 | id | 预期 | 详情 / SKIP 原因 |
|---|---|---|---|
| 🟢 PASS | L0-STONE-REPO | ensureStoneRepo 后 stones/main/ 是 git 工作区（.git 存在） |  |
| 🟢 PASS | L0-CREATE-STONE | 建对象后 stones/main/objects/<id>/ 出现 package.json + self.md |  |
| 🟢 PASS | L0-STONE-GIT | 建对象的 self.md 进 git（至少 1 个 commit，可审计） |  |
| 🟢 PASS | L0-SELF-COMMIT | 经 HTTP PUT 改 self 在 stones/main 多出一个 commit |  |
| 🟢 PASS | L0-POOL-NOGIT | 建对象同时建 pools/<id>/ 骨架，且 pool 是独立于 stones 的子树 |  |
| 🟢 PASS | L0-THREE-SUBTREES | 一次会话后 stone(git)/pool(持久)/flow(运行) 三子树各就位 |  |
| 🟢 PASS | L0-GITIGNORE | stones/main/.gitignore 白名单 objects/、黑名单运行时（threads/） |  |

## session

| 状态 | id | 预期 | 详情 / SKIP 原因 |
|---|---|---|---|
| 🟢 PASS | L1-SESSION-DIR | 发起 session 后 flows/<sid>/ 目录出现 |  |
| 🟢 PASS | L1-SEED-RESPONSE | POST /api/sessions 返回 sessionId 与 targetThreadId |  |
| 🟢 PASS | L1-SESSION-WORKTREE | flows/<sid>/ 是 stones/main 派生的 git worktree（.git 是 link 文件） |  |
| 🟢 PASS | L1-SESSION-META | flows/<sid>/.session.json 存在且记录 sessionId |  |
| 🟢 PASS | L1-THREAD-JSON | 和某对象会话后 flows/<sid>/objects/<oid>/threads/<tid>/thread.json 出现 |  |
| 🟢 PASS | L1-THREAD-CONTEXT | 同一 thread 下 thread-context.json 出现（contextWindows 唯一权威） |  |
| 🟢 PASS | L1-THREAD-NO-WINDOWS | thread.json 不含 contextWindows 字段（§10 退役，单点权威分离） |  |
| 🟢 PASS | L1-WORKTREE-GITIGNORE | session worktree 继承 main 的 .gitignore（运行时产物不进 git） |  |

## thinkable

| 状态 | id | 预期 | 详情 / SKIP 原因 |
|---|---|---|---|
| 🟢 PASS | L2-KNOWLEDGE-INDEX | 对象 knowledge/*.md 经 loadKnowledgeIndex 可加载进索引 |  |
| 🟢 PASS | L2-ROOT-KNOWLEDGE | root 协议知识（ROOT_KNOWLEDGE）列出可用 root method |  |
| 🟢 PASS | L2-CONTEXT-WINDOW-TYPES | 已注册 ObjectType 经 /api/windows/_shared/types 暴露 type + methods |  |
| 🟢 PASS | L2-KNOWLEDGE-INHERIT | instance 经 class 链继承框架 class 的 seed knowledge |  |
| ⬜ SKIP | L2-CONTEXT-MULTITURN | 多轮 context 连贯（窗口跨轮保留/压缩）——需真 LLM 多轮 | 多轮 context 连贯质量需真 LLM thinkloop，控制面不可确定性验证（Tier B） |

## executable

| 状态 | id | 预期 | 详情 / SKIP 原因 |
|---|---|---|---|
| 🟢 PASS | L3-REG-EXECUTABLE | registerExecutable 只注册 object methods + 类元，拒绝 readable 字段 |  |
| 🟢 PASS | L3-REG-READABLE | registerReadable 注册 windowMethods/readable，与 executable 互不覆盖 |  |
| 🟢 PASS | L3-METHOD-COLLISION | 同一 type 上 object method 与 window method 同名 → 注册期 fail-loud |  |
| 🟢 PASS | L3-FILE-WINDOWMETHOD | builtin file 的 set_viewport 是 windowMethod，不在 object methods 表 |  |
| 🟢 PASS | L3-CONSTRUCTOR-LOOKUP | kind=constructor 的 method 经 lookupConstructor 命中 |  |
| 🟢 PASS | L3-PARENTCLASS-CHAIN | 未注册 type 经 parentClass 链回退解析 method |  |
| 🟢 PASS | L3-UI-METHOD-CALL | Object 的 ui_methods 经 HTTP /call_method 执行并返回结果 |  |
| 🟢 PASS | L3-WINDOW-COMMAND-LOAD | Object 的 window.methods（LLM 路径命令）经 loadObjectWindow 可加载 |  |

## collaborable

| 状态 | id | 预期 | 详情 / SKIP 原因 |
|---|---|---|---|
| 🟢 PASS | L4-USER-TALK | seedSession 在 user 线程上建对 target 的 talk_window |  |
| 🟢 PASS | L4-DELIVER-INBOX | 初始消息投递到 callee 线程的 inbox（inbox/msg_*.json） |  |
| 🟢 PASS | L4-TALK-BUILTIN-FEATURE | talk window 是 isBuiltinFeature（inline 进 thread-context，不写独立 dir） |  |
| ⬜ SKIP | L4-CROSS-OBJECT-TALK | agent 主动 talk 别的对象 → 双方各落 thread（需 worker） | agent 主动 talk 需 worker/LLM thinkloop，控制面不可确定性验证（Tier B） |
| ⬜ SKIP | L4-PR-ISSUE-FILE | cross-scope evolve 越界 → flows/super/issues/issue-<id>.json 出现 | PR-Issue 由 super flow evolve_self cross-scope 触发，需 worker 编排（Tier B/e2e） |
| ⬜ SKIP | L4-RELATION-POOL | relation 落 pools/<id>/knowledge/relations/<peer>.md | relation 沉淀由 collaborable 运行流触发，需 worker（Tier B） |

## observable

| 状态 | id | 预期 | 详情 / SKIP 原因 |
|---|---|---|---|
| 🟢 PASS | L5-DEBUG-TOGGLE | debug enable 后 /api/runtime/debug/status 返回 enabled=true |  |
| 🟢 PASS | L5-ACTIVITY | /api/runtime/activity 返回 now / runningCount / jobs 结构 |  |
| 🟢 PASS | L5-GLOBAL-PAUSE | global-pause enable→status enabled，disable→status disabled |  |
| 🟢 PASS | L5-JOB-STATUS | 发起 session 产生的 job 经 /api/runtime/jobs/:id 可查 status |  |
| ⬜ SKIP | L5-DEBUG-SNAPSHOT | 跑一轮 thread 后 debug/llm.input.json + llm.output.json 落盘 | LLM 调用快照需 worker 真跑 thinkloop，控制面无 LLM（Tier B） |
| ⬜ SKIP | L5-LOOP-DEBUG | 多轮 loop 各自落 loop_<N>.{input,output,meta}.json | loop 快照需 worker 多轮 thinkloop，控制面无 LLM（Tier B） |

## reflectable

| 状态 | id | 预期 | 详情 / SKIP 原因 |
|---|---|---|---|
| 🟢 PASS | L6-WORKTREE-WRITE | 业务 session 内改自身 self 落 worktree，stones/main canonical 不变 |  |
| ⬜ SKIP | L6-EVOLVE-FFMERGE | evolve_self self-scope → ff-merge 回 main，留署名 commit | evolve_self 由 super flow 编排（end→evolve），需 worker（Tier B/e2e） |
| ⬜ SKIP | L6-EVOLVE-CROSS-PR | evolve_self cross-scope（改/建别人对象）→ 开 PR-Issue 待评审 | cross-scope evolve 需 super flow 编排，控制面无 worker（Tier B/e2e） |
| ⬜ SKIP | L6-MEMORY-POOL | long memory 落 pools/<id>/knowledge/memory/<slug>.md | memory 沉淀由 super flow 触发，需 worker（Tier B） |
| ⬜ SKIP | L6-CREATE-OBJECT-WORKTREE | create_object 在业务 session 落 session worktree objects/<newId>/（未即合入 main） | create_object 是 root method，需 agent 在 worker thinkloop 调（Tier B） |

## programmable

| 状态 | id | 预期 | 详情 / SKIP 原因 |
|---|---|---|---|
| 🟢 PASS | L7-EXEC-HOTRELOAD | 改写 executable/index.ts 后 loadObjectWindow 加载到新 method |  |
| 🟢 PASS | L7-UI-METHOD-HOTRELOAD | 改 ui_methods 后 /call_method 反映新逻辑 |  |
| 🟢 PASS | L7-SERVER-SOURCE-RW | PUT 再 GET /api/stones/:id/server-source 读写一致 |  |

## visible

| 状态 | id | 预期 | 详情 / SKIP 原因 |
|---|---|---|---|
| 🟢 PASS | L8-CLIENT-URL-STONE | stone scope client-source-url 指向 visible/index.tsx（单页） |  |
| 🟢 PASS | L8-TYPES-CATALOG | /api/objects/_shared/types 列出全部已注册 type |  |
| 🟢 PASS | L8-WORLD-CONFIG | /api/world/config 返回 siteName 等 world 级配置 |  |
| ⬜ SKIP | L8-CLIENT-URL-FLOW | flow scope client-source-url 指向 client/pages/:page.tsx（多页） | flow scope 多页 client 资产 + live Vite 渲染需 F 层（Tier B/frontend e2e） |

## class

| 状态 | id | 预期 | 详情 / SKIP 原因 |
|---|---|---|---|
| 🟢 PASS | L9-INSTANTIATE | instantiate 把 supervisor class 实例化为 objects/supervisor（拷 self.md + ooc.class） |  |
| 🟢 PASS | L9-INSTANTIATE-IDEMPOTENT | 二次 bootstrap 跳过已存在 instance、保用户改动 |  |
| 🟢 PASS | L9-CLASS-NOT-USER | user 是被动对象，不被实例化为可交互 instance |  |
| 🟢 PASS | L9-CLASS-NONINTERACTIVE | seedSession 拒绝 _builtin/ class 作为对话目标（400） |  |

## 设计锚点对照

| id | 锚定的 OOC 设计 |
|---|---|
| L0-STONE-REPO | persistable：stones/main 是 versioning canonical（方案 A worktree）。persistable/bootstrap.ts |
| L0-CREATE-STONE | persistable：stone identity 落 stones/main/objects/<id>/。modules/stones/api.create-stone.ts |
| L0-STONE-GIT | persistable：stone identity 进 git tracked、可回溯。versioning.ts |
| L0-SELF-COMMIT | persistable：身份演化经 worktree commit 版本化、可审计可回滚。modules/stones/api.put-self.ts |
| L0-POOL-NOGIT | persistable：pool = 持久但不进 git 的事实子树，与 stone(git) 分离。persistable/pool-object.ts |
| L0-THREE-SUBTREES | persistable：三子树分离——stone 持久+git / pool 持久不git / flow 运行层。persistable 顶层布局 |
| L0-GITIGNORE | persistable：身份进 git、运行时产物（threads/state.json/.flow.json）不进 git。persistable/bootstrap.ts |
| L1-SESSION-DIR | flow：session 是 flows/<sid>/ 下的运行层子树。modules/flows/api.seed-session.ts |
| L1-SEED-RESPONSE | 控制面：seedSession 一次性建 session + user flow + 初始 talk + 派初始消息。api.seed-session.ts |
| L1-SESSION-WORKTREE | reflectable/persistable：session identity = lazy/eager git worktree 分支。stone-worktree.ts:ensureSessionWorktree |
| L1-SESSION-META | flow：session 级运行时元数据。persistable/flow-object.ts:createFlowSession |
| L1-THREAD-JSON | thinkable/flow：thread 状态落 thread.json。persistable/thread-json.ts:writeThread |
| L1-THREAD-CONTEXT | thinkable §10：contextWindows 权威落 thread-context.json，与 thread.json 分离。flow-thread-context.ts |
| L1-THREAD-NO-WINDOWS | thinkable §10：thread.json 退役 contextWindows，避免与 thread-context.json 双写漂移。thread-json.ts |
| L1-WORKTREE-GITIGNORE | persistable：worktree 是 main HEAD 完整副本，含 .gitignore；运行时产物被黑名单。stone-worktree.ts |
| L2-KNOWLEDGE-INDEX | thinkable：knowledge 沿 stone/pool 加载成可激活索引。thinkable/knowledge/loader.ts:loadKnowledgeIndex |
| L2-ROOT-KNOWLEDGE | thinkable：root window 每轮注入协议知识，告诉 LLM 能调哪些 root method。builtins/root/executable |
| L2-CONTEXT-WINDOW-TYPES | thinkable/executable：ContextObject 类型目录。modules/ui/api.list-window-types.ts |
| L2-KNOWLEDGE-INHERIT | thinkable+class：knowledge 沿 parentClass 链回退继承。loader + 继承链 |
| L2-CONTEXT-MULTITURN | thinkable：thinkloop 多轮上下文连贯 + compress。需真 LLM，归 Tier B。 |
| L3-REG-EXECUTABLE | executable：维度劈分入口。runtime/object-registry.ts:registerExecutable |
| L3-REG-READABLE | readable：维度劈分入口；两维度分注册不互相 clobber。object-registry.ts:registerReadable |
| L3-METHOD-COLLISION | executable/readable：exec 名全局唯一，dispatch 无歧义。assertNoMethodNameCollision |
| L3-FILE-WINDOWMETHOD | readable：展示控制方法归 windowMethods（readable 维度），与业务 method 分离。builtins/file/readable.ts |
| L3-CONSTRUCTOR-LOOKUP | executable：root 命令委托到 Object constructor。object-registry.ts:lookupConstructor |
| L3-PARENTCLASS-CHAIN | class/executable：method 沿 parentClass 链回退（缺省继承 root）。resolveMethod |
| L3-UI-METHOD-CALL | executable：ui_methods 是 Object 暴露给 UI 的方法（经 HTTP）。modules/stones/api.call-method.ts |
| L3-WINDOW-COMMAND-LOAD | executable：window.methods 是 Object 暴露给 LLM 的命令面。runtime/server-loader |
| L4-USER-TALK | collaborable：跨对象会话经 talk_window 投递。modules/flows/api.seed-session + windows/talk |
| L4-DELIVER-INBOX | collaborable：消息以 per-message append-only 落 callee inbox。persistable inbox |
| L4-TALK-BUILTIN-FEATURE | collaborable：talk/do 是 Object 内置特性，状态 inline。windows/talk registerExecutable isBuiltinFeature |
| L4-CROSS-OBJECT-TALK | collaborable：peer 平等轴经 talk 协作。需真 LLM 主动行动，归 Tier B。 |
| L4-PR-ISSUE-FILE | collaborable：越自治区改动开 PR-Issue 待 Supervisor 评审。persistable/pr-issue.ts |
| L4-RELATION-POOL | collaborable：对象关系沉淀进 pool relations。pool relations |
| L5-DEBUG-TOGGLE | observable：debug 开关经 HTTP 可切换可查询。modules/runtime/api.enable-debug / get-debug-status |
| L5-ACTIVITY | observable：运行时活动快照（诊断卡顿）。modules/runtime/api.activity.ts |
| L5-GLOBAL-PAUSE | observable：全局暂停经 HTTP 可切换。modules/runtime/api.*-global-pause |
| L5-JOB-STATUS | observable/app-server：runtime job 语义可查询。modules/runtime/api.get-job.ts |
| L5-DEBUG-SNAPSHOT | observable：每次 LLM 调用前后抽 context/输出快照。persistable/debug-file.ts。需 worker（Tier B） |
| L5-LOOP-DEBUG | observable：multi-turn loop 每轮独立快照。api.list-loop-debug。需 worker（Tier B） |
| L6-WORKTREE-WRITE | reflectable：业务 session 是试验层（worktree），main 是 canonical。stone-worktree.ts:ensureSessionWorktree |
| L6-EVOLVE-FFMERGE | reflectable：evolve_self 把 worktree 改动合入 main。programmable/evolve-self.ts:tryMergeSelf。需 worker |
| L6-EVOLVE-CROSS-PR | reflectable：越自治区改动不直接合入，转 PR-Issue。evolve-self.ts cross-scope |
| L6-MEMORY-POOL | reflectable：super flow 沉淀 memory 到 pool。reflectable memory merge。需 worker |
| L6-CREATE-OBJECT-WORKTREE | reflectable：建新对象先落试验层，end→evolve 合入。persistable/stone-create-object.ts。需 worker |
| L7-EXEC-HOTRELOAD | programmable：Object 自写方法库，运行时热更（fs.watch）。runtime/server-loader |
| L7-UI-METHOD-HOTRELOAD | programmable：ui_methods 热更后 HTTP 调用走新实现。server-loader 热更 + api.call-method |
| L7-SERVER-SOURCE-RW | programmable：Object 方法源经控制面可读可写。modules/stones/api.put/get-server-source |
| L8-CLIENT-URL-STONE | visible：ooc://client/... 原生寻址映射到 visible 源文件。modules/ui/api.client-source-url.ts |
| L8-TYPES-CATALOG | visible/executable：对象类型目录（前端按 type 索引 method）。api.list-window-types 别名 |
| L8-WORLD-CONFIG | visible/app-server：world 级公开配置（前端 Logo 等）。modules/world-config/index.ts |
| L8-CLIENT-URL-FLOW | visible：flow 作用域是多页应用。api.client-source-url 形态2。需多页 client 资产 |
| L9-INSTANTIATE | class：builtin class 经 instantiate_with_new_world 落为 world object 实例。bootstrap/instantiate-classes |
| L9-INSTANTIATE-IDEMPOTENT | class：实例化幂等，不覆盖用户对实例的修改。instantiate-classes 幂等 |
| L9-CLASS-NOT-USER | class：user 无 executable，不作为可交互 class 实例化。instantiate 排除 user |
| L9-CLASS-NONINTERACTIVE | class：class 不可交互，仅供继承。modules/flows/api.seed-session 目标校验 |

