# OOC-as-Object 重构弧 —— 设计 + 增量序列（2026-06-14）

来源：用户 `2026-06-14-next_todo.md` 路线图（#1-#5）+ 本会话裁决「.ooc-world-meta/stones/main/objects/supervisor/children/thinkable/knowledge/context.md 的 class-dynamic/thread-window/share-object 三条核心延后、绑此弧落地」（见 [[project_context_redesign]] / `docs/2026-06-14-context-redesign-impl-plan.md`）。
一句话目标（用户原话）：让 OOC 更好地表达**从 OOP 继承而来的面向对象哲学与表达力**。

## 接地的现状（2026-06-14 实测）
- `builtins/` 下多数 builtin 已是 ooc-object 包形态（file/todo/plan/world/filesystem/terminal/knowledge/knowledge_base/search/skill_index/program/example/root/agent/supervisor/user，各有 self.md+executable+readable+types+package.json）。
- 但 `core/runtime/object-registry.ts` 的 `BASE_TYPE_DEFINITIONS` 仍把**窗类型**（todo/talk/pr/reflect_request/program/file/knowledge/search/skill_index/plan/feishu_* + filesystem/terminal/world/knowledge_base/root/method_exec/example）平行硬编码为裸 `{methods:{}, parentClass:null}`——**对象 dir 与窗注册尚未统一**。
- `reflectable` 仍在 `core/reflectable/{index.ts, pr/, reflect-request/}`，是 window-family 实现模块（side-effect 注册），**非** builtins 下的 ooc-object 包。
- registry 已有 `entry.kind === "constructor"` 概念（非单例实例化的雏形）；`runtime` 已从 module-singleton 重构为按 World 聚合的可实例化类。
- agency 已在 `_builtin/agent`（talk/plan/todo/end）；root 是最小 Object 基类（example+feishu），但 thinkable/collaborable/reflectable 维度能力**尚未明确从 object 抽到 agent 层**（#5 未竟）。
- 绿基线：core 918/0、storybook 63/0、verify 全绿。

## 设计模型（Supervisor 提案，待经 class 维度 self.md 正式化 / 用户可 grill）

### M1 class vs object，单例 vs 非单例，constructor（next_todo #4）
- **ooc class** = 定义（self.md 身份 + ooc.class 继承 + methods + readable + 可选 constructor）。**ooc object** = 运行时实例。
- **单例 class**：class 即 object（唯一实例），无需 constructor，直接可寻址。例：supervisor、各 agent、tool-object（filesystem/terminal/world/knowledge_base）。
- **非单例 class**：提供 **constructor**，每次调用产出一个 object 实例（其 context 投影 = 一个 window）。例：file（open_file 构造）、talk（talk 构造）、todo/plan/knowledge/search/method_exec/pr/reflect_request。
- 由此澄清：现「builtin 窗类型」绝大多数是**非单例 class，其实例是 context window**；tool-object/agent 是**单例 class**。这条把"窗类型"与"ooc class"统一成一个概念，是 #2 的前提。

### M2 builtin context window 作为 ooc class/object（next_todo #2/#3）
- 每个 builtin 窗类（file/talk/todo/plan/knowledge/search/pr/reflect_request/...）是 builtins/ 下一个**非单例 ooc class 包**：提供 constructor + readable（含**按视角算 class**）+ method 注册。
- `core` 不再硬编码 `BASE_TYPE_DEFINITIONS`；改为从 builtins 的 class 定义加载（core **开放接口**供 builtin class 的 method 调用——即 next_todo #2 的"core 开放接口"）。
- #3 = 把 `core/reflectable/{pr,reflect-request}` 变成 builtins/ 下的 ooc class 包；`core/reflectable/index.ts` 退化为**源码索引**（re-export，便于"找 reflectable 相关代码"）。

### M3 class-dynamic 落地（context.md 核心 2/7/9/11，本弧解锁的关键收益）
- M2 之后每个窗都有对应 ooc class/refObjectId ⇒ class 可由 readable 按视角动态算、**不再持久化**（核心 7）：thread-context.json 只存 object id + 展示状态。
- thread 也是 ooc object：自己视角 readable 算出 thread window（句柄、内容进 message 流）、他者视角算出 talk window（核心 9/10）。
- share 传 object 引用、class 由对方 readable 按其视角算（核心 11）。

### M4 persistable 自定义（next_todo #1）
- 持久化成为 ooc object 的**可覆盖能力**：`core/persistable` 现实现 = 默认方式；builtin class/object 可覆盖自己的持久化表示。
- 动机：thread 已是 ooc object，与其为 thread 特例化持久化，不如把特例化变成 ooc object 的个性化能力。

### M5 thinkable/collaborable/reflectable 上提到 ooc agent（next_todo #5）
- **ooc agent extends ooc object**；只有 agent 具备与 LLM 交互（thinkable）+ 协作（collaborable）+ 反思（reflectable）能力。
- root = 最小 ooc object 基类（无 LLM 智能）；`_builtin/agent` = object + thinkable/collaborable/reflectable + agency；supervisor extends `_builtin/agent`。
- 用户已指出 root 没改彻底——把仍寄居 root/object 层的智能能力归位到 agent 层。

## 增量序列（依赖序；每个增量 = 设计对准 + 代码 + storybook + 退潮，绿色提交）
1. **A1 · M1 模型正式化**（设计为主、低风险）：把 M1（class/object/单例·非单例/constructor）写进 class 维度 self.md/knowledge 与 supervisor 知识，统一"窗类型=非单例 class"措辞。**建议先做**——它是 #2 的概念地基，且可让用户 grill。
2. **A2 · M2 builtin 窗类归位**（大）：先 reflectable(pr/reflect_request)→builtins（#3，立 pattern），再逐个把 BASE_TYPE_DEFINITIONS 的窗类迁为 builtins 下 ooc class 包 + core 从 builtins 加载（#2）。**unblocks class-dynamic**。
3. **A3 · M3 class-dynamic 落地**（context.md 核心 2/7/9/11）：停止持久化 class、readable 按视角算 class、thread-window/talk-window 双投影、share=object 引用。
4. **A4 · M5 agent/object 分层清理**：root 最小 object、智能维度上提 agent。
5. **A5 · M4 persistable 自定义**：持久化作可覆盖 object 能力，thread 持久化去特例化。

> 风险/纪律：① 每步保 `bun run verify` + `test:storybook` 绿、小步提交。② 新 builtin 包需 5 处接线 + **手动 `ln -s`**（避 `bun install` bnpm hang）。③ 退役符号往 `check-doc-deprecated-drift.sh` FORBIDDEN 加精确模式、全树回流。④ 两套 story 体系（gate `<cap>.story.ts` + catalog `L*.stories.ts`）都要扫。⑤ 同名陷阱：window 投影 class（不持久化）vs ooc.class 继承链（落 .flow.json，仍持久化）——勿混。

> 执行建议：本弧每个增量都重，宜在**聚焦的新会话**逐个推进（本会话已极长）；A1 可先行（设计、低风险）。

---

## S3 thread-as-object 执行分解（2026-06-15，Explore 侦察 + 设计歧义裁决）

现状：thread 是纯运行时 struct（`_shared/types/thread.ts` ThreadContext），say/wait/end 散在 talk 窗/tools/root；无 ThreadWindow 类型；持久化走 thread.json + thread-context.json + inbox-store/ 三档（非常规 state.json）。目标（thread.md/agent.md 核心 9）：thread = builtin ooc class 实例。

**4 个设计歧义的裁决（依定稿文档，自主拍板）**：
1. **say/wait/end 归属**：归 `thread` class（thread.md 核心 3 明列为 thread 行为）。thread window（自己视角）/ talk window（他者视角=远端 thread 投影）都是 thread 对象的视角投影、经类链拿到这些方法；say 的"自己视角向对方发 / 对方视角向自己发"双实现由"窗是 thread window 还是 talk window"+ 现有 fork/peer 路由承载。
2. **thread 持久化**：S3 **保持现状三档**（不强行并 state.json）；其"特例化"在 S5 重表为 thread class 自己的 `persistable/index.ts` override（next_todo #1：把特例化变成 object 个性化能力），不是框架特判。
3. **thread window vs talk window**：thread 自己视角投影 = thread window（句柄、内容进 message 流）；远端 thread 在我 context 的投影 = talk window。现 code 用 talk_window+creator_window+isCreatorWindow，S3 引入 thread window 作自我投影（衔接 context.md 核心 9/10）。
4. **thread class 无 constructor**：对——thread 由 agency `talk` 创建、非 open() 构造。registerWindowClass 注册 thread 时**不带 constructor**（区别于 file/todo）。

**子步分解（每步独立可验、保持绿；3 低风险类型对齐 / 3 中风险功能迁移 / 1 高风险持久化）**：
- **S3.1（低）**：建 `builtins/thread` 包（package.json kind=class objectId=_builtin/thread、types.ts ThreadWindow、executable/index.ts registerWindowClass methods:{} skeleton、symlink）。验：tsc + registry 能查到 thread type，无行为变。
- **S3.2（中）**：say 迁 thread class（talk/method.say.ts 核心逻辑 → thread.say，talk 窗 delegation 保留）。验：fork+peer say 通。blast：talk-delivery、talk-fork-thread-tree.test。
- **S3.3（作废/质疑修正）**：~~wait 迁 thread.wait method~~ —— **作废**。`wait` 是 3 原语之一（顶层 tool `exec/close/wait`，见 context.md 派生能力 + thinkloop.md），**不是 method**；迁成 method 会破坏原语面。wait 本就作用于"当前正在跑的 thread"（设 status=waiting），语义已正确。thread.md 核心 3 列 wait 为 thread"行为"指它改 thread 状态、非指它是注册 method。S3.3 实为 no-op / 文档澄清，**不迁 wait**。
- **S3.4（中，待评审）**：end 迁 thread class（end 现在 agency `_builtin/agent` 上、改/end 当前 thread）。**待细究 thread-vs-agency 归属**：倾向"say/end 是 thread 的 method、agent 经其 self/会话窗 exec 调用"（与 S3.2 say 共享窗模式一致），但 end 现属 agency（agent 才能 end）；落地前评审 agent 怎么 exec 到迁后的 thread.end（经 S3.6 thread window 自我投影）。验：status/endReason/endSummary。blast：worker、commands-execution.test。
- **S3.5（低）**：thread readable + compressView hook（thread 自我视角渲染 + events 折叠）。
- **S3.6（低-中）**：thread window 自我投影注入（talk-delivery/init 在 thread 自己 context 注入 thread window）；对接 S2 class 动态推导（thread window class 由 thread 对象 _builtin/thread 推出、不存储）。
- **S3.7（高）**：持久化一致性评审/收尾（三档是否保留 + 文档明确；接 S5）。

**与 S2 接口**：thread-as-object 后所有 thread 统一 class=`_builtin/thread`（thread 是跨对象的协作载体、say/wait/end 通用）；talk window 的 targetThreadId 指向的 thread，其 class 由 persistence.objectId/类型推出、不存储 class 字符串 → 这是 S2 class-dynamic 对 thread/talk 窗的落点。

**执行建议**：S3.1 起逐子步派聚焦 sub-agent，每步 verify+storybook 绿、双库提交；S3.7 前做持久化设计评审。**勿一把梭**（240+ 测试 + 持久化契约，Big Bang 会卡）。

---

## S3.4 / S3.6 / S2「心脏」定稿（2026-06-15，3 轮对抗 workflow 评审 + 用户拍板 self-model）

> 来源：本会话对 S3.4/S3.6/S2 三耦合子步做了 3 轮对抗式评审（recon 核验代码 ground-truth → design-review v1 被破 → corrected verdict-v2 验证），逐条按真实代码裁决；唯一基础分叉「运行中 agent 的自我操作面」由**用户拍板 = Split**。下文为定稿，覆盖 S3 末节里 S3.4「待评审」与歧义 3 的悬置部分。

### 核心裁决：self-model = **Split**（用户 2026-06-15 拍板）

运行中 agent 的 context 含**两个**自我相关窗，各司其职、都合法：

- **agent self 窗**（`id=objectId`，class=agent 自身 class）：承载 **agent 对象方法**——agency `talk`/`plan`/`todo` + 该 agent 自定义 object method。**仍是 `exec` 缺省窗**（window-less exec 落它）。身份正文走 instructions（self.md），此窗是**方法面**而非身份壳（与 context.md 3.2「不另起空 self 窗」不冲突：3.2 禁的是空身份壳，方法面保留）。
- **thread 窗**（自视角，class=`thread`）：承载 **thread 行为** `say`(对 creator)/`end`(本 thread)；内容通道 = 本 thread 的 events + 与 creator 的对话（XML 只渲方法句柄、内容进 message 流并纳预算，context.md 核心 10）。
- peer/sub → **talk 窗**（他者视角，远端 thread 投影）。

> 放弃的 Unified 方案（一个 thread 窗即自我、承载 thread 行为 + agent 方法）：需让 thread 窗 per-POV `parentClass=owning-agent`，而 registry `resolveParentClassChain` 只认静态 class 字符串——要么改 registry 解析签名、要么在自视角做特例方法聚合，均属新机制，触「勿过度机制化」。Split 改动更小（self 窗与 exec 缺省逻辑不动）、OOP HAS-A 更干净（agent 持有 thread，非 IS-A）。

### 落地裁决（逐条按代码核实，覆盖原 S3.4 / 歧义 3）

1. **`end` → thread class**（实质化 thread.md 核心 3「end 是 thread 行为」）：从 `builtins/root/executable/index.ts` 的 `AGENCY_METHODS` 移除 end（agency 只留 talk/plan/todo），注册到 `_builtin/thread`（与 say 并列、可如 say 那样共享给会话窗）。LLM 显式 `exec(thread窗, "end", {result?})`——**end 不再 window-less**（可接受的调用约定变更，/goal 授权不保全存量）。
2. **end 自动回 creator 改路由**：现 `method.end.ts` 用 class-keyed `findCreatorWindow`（找 `class∈{talk,reflect_request}&&isCreatorWindow` 窗）——collapse 后该窗 class 变会失效。改为：end（运行在 thread 上下文）由 **`thread.persistence`（creatorThreadId/creatorObjectId/creatorSessionId）+ 导出 `isCreatorSelf`** 算 fork/peer 路由，经 say 投递（已核实 thread.persistence 带齐这些字段、`sayToForkWindow`/`sayToPeerWindow`/`deliverTalkMessage` 跨 session 路由原语齐备）。supervisor 的 creator=passive `user` 仍是合法 creator（跨 session 投递到 user session）。
3. **thread 窗 = 今 self-side creator 窗的 reframe**（歧义 3 定稿）：自视角 class `talk`/`reflect_request` → `thread`；events 折入其内容通道；渲染改为 XML 只渲方法 + 内容进 message 流（核心 10）；close 仍拒（自视角不可关，沿用今 creator 窗 `creator_talk_window_close_rejected`）。远端 thread（peer/sub）仍投影为 talk 窗。
4. **`reflect_request` = super-session 自视角 thread 变体**（`parentClass=thread`）：super session 下自视角窗 class=`reflect_request`（而非 `thread`），从而既得 say/end 又保住 reflectable 方法（new_feat_branch/create_pr_and_invite_reviewers）。
5. **S2 class-per-POV**（context.md 核心 2/7 落地，**只切 thread/talk 投影**）：thread/talk 投影 class 构建时算、**停持久化**——自视角=`thread`(super→`reflect_request`)、他者=`talk`；**reload 确定性**由 owning thread 持久化的 `sessionId` + 结构角色推出（本地总可知，无需读远端）；**非** thread/talk 窗 class=真实 ooc.class（registry/.flow.json）不变；`.flow.json` `FlowObjectMetadata.class` 绝不动（同名陷阱：投影 class ≠ ooc.class 继承链）。读旧 flow 时忽略已存 class、一律重算（tolerant read）。
6. **`wait` 接 thread 窗**：`wait.ts` 的 `listValidWaitTargets`/`WaitCandidate` 加 `class='thread'`（否则「wait 等 creator 回复」落不到 thread 窗）。**wait 三面冗余**（`WAIT_TOOL` 原语 / talk·reflect_request 上的 `waitMethod` / `say(wait=true)`）= 独立退潮项，本弧只标记不并（S3.3 成立：wait 是原语非 method）。
7. **`exec.ts` 缺省窗逻辑不改**（Split 红利）：agent self 窗仍在、仍是 window-less exec 落点。

### 绿增量序（替代原 S3.4→S3.6 列序；勿一把梭）

| 增量 | 内容 | 绿判据 |
|---|---|---|
| **H1** | thread/talk 投影 class **构建时算 + 停持久化**，值与今**完全一致**（behavior-identical）；窄域只碰 thread/talk/creator/fork 窗，其余窗 class 不动 | verify + storybook 绿、无行为变（de-risk 持久化机制，与语义翻转解耦） |
| **H2a** | **end→thread**（S3.4）：agency 去 end、thread 注册 end、共享给会话窗、auto-reply 改 thread.persistence 路由、导出 isCreatorSelf | fork/peer/跨 session end 回复通；改/删旧 agency-end 测试 |
| **H2b** | **thread 窗自视角**（S3.6 + 引入 `thread` class + 核心 10 渲染）：creator 窗→thread 窗、events 折入、reflect_request extends thread | self-view 渲染 + 投影测试；改旧 creator/self 窗形态断言 |
| **H2c** | **wait 接 thread 窗**（surgical） | wait-for-creator-reply 落 thread 窗通 |
| **S3.5** | thread readable + compressView（自视角渲染 + events 折叠） | |
| **S3.7** | 持久化一致性收尾（接 S5） | |
| **S5** | persistable 自定义（thread 持久化去特例化为 class override，next_todo #1） | |

> 文档：context.md 核心 9/10 + 2/7 **已预先编码本设计**，实现多为补 code-vs-doc gap；**新增 doc** = context.md 3.2 段加 Split self-model 澄清（agent self 窗=方法面、与 thread 窗并存）+ object-model/agent/builtins 把 agency 措辞改 `talk/plan/todo`、thread 列 `say`+`end`。
