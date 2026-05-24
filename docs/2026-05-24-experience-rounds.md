# AgentOfExperience 体验循环报告

> 体验官（AgentOfExperience，定义见 `meta/engineering.harness.doc.ts:agent_of_experience`）
> 的持续 dogfood 输出。每轮独立报告 + Supervisor triage，聚合于此文档以形成 audit trail，
> 让下一轮体验官能站在前一轮肩上而不是重复挖坑。
>
> **本文档的读者**：
> - 下一轮 AgentOfExperience（避开已识别 backlog，专攻新区域）
> - 各 AgentOfX（看自己维度被点名的 Issue / 反向 design 反馈）
> - Supervisor 自己（追溯 triage 决策与 design 演化）

---

## Round 1（2026-05-24）— 验证 stone/pool 简化链路

**任务范围**：验证 4 阶段工程改造（清理 sql/database / seed knowledge 双源加载 / data csv 落地 / 存量清理 + 文档同步）在真实使用中是否成立。

**评分总览**：6/6 维度通过，Good × 4 / OK × 2。

**Issue 候选**（已全部在 commit `6dc7209` 收尾）：

| Issue | 严重度 | 状态 |
|---|---|---|
| `createStoneObject` 物理骨架与"五件套"措辞冲突（visibility-first 失守） | Medium | ✅ 修：预创 .stone.json + self.md + readme.md（空占位）；其它 lazy mkdir |
| `docs/2026-05-23` line 53 sql/data.sqlite 残留 | Medium | ✅ 修：顶部双修订指针 + `[OBSOLETE 05-24]` 内联标记 |
| `--port` CLI flag 未解析 | Low | ✅ 修：readServerConfig 支持 --port + 范围校验 |
| advisory 单行 ~250 字符易截断 | Low | ✅ 修：actionable 前置 + ~60 字符首行 |

**反向 design 反馈**（产出 meta 规范）：

| 反馈 | 落地 |
|---|---|
| "五件套" 是逻辑契约 vs 物理骨架 | ✅ `persistable.stone` 加"逻辑契约 vs 物理骨架"段 |
| design doc 历史化模板 | ✅ `engineering.harness.patches.design_doc_historization` 新增 |
| csv schema drift 可观测性 | ✅ `persistable.pool.children.data_pool.todo` 加 known-limitation |

**相关 commit**：`89a1cdc`（stone/pool 简化主干）+ `6dc7209`（收尾 Issue + 设计规范）

---

## Round 2（2026-05-24）— 横向探索其它维度

**任务范围**：本轮 commit 改动**之外**的 OOC 系统其它维度。自选 2-3 个深度场景。

**选定场景与评分**：

| 场景 | 维度 | 评分 |
|---|---|---|
| A. web 控制面 HTTP 真实路径 | visible | **OK with sharp edges** |
| B. pause / resume / debug 文件链路 | observable | **Bad** |
| C. skill_index window 真实激活 | thinkable.knowledge | **Bad（critical）** |

### Round 2 Issue 清单

> 状态：均**未修复**（backlog）。下一轮体验官请避开这些区域；各 AgentOfX 接到派单时优先处理。

| # | 严重度 | 维度 | Issue 一句话 | Supervisor 派单归属 |
|---|---|---|---|---|
| **1** | Critical | thinkable | skill_index window 在 LLM XML 渲染丢 skills payload（render.ts 缺 type-specific renderer） | C1 cluster → AgentOfThinkable |
| **2** | Critical | observable / app | `/api/runtime/.../debug` endpoint baseDir 默认 cwd，与 --world 协议冲突；endpoint 已被前端绕过（实际死路） | Supervisor 拍板下线 → C2 |
| **3** | High | collaborable / executable | resume 几乎 100% 产 failed job —— 同步翻状态 + worker job 双写冲突 | Supervisor 拍板时序 → C3 |
| **4** | High | observable | paused 状态无 provenance（pausedBy / pauseReason / pausedAt 全缺） | C3 cluster |
| **5** | High | visible | thread context 响应 window 对象无 commands / availableCommands 字段（LLM 看不到可调命令） | C1 cluster（与 #1 同源） |
| **6** | High | visible | tree scope marker 在 2026-05-21 stones 重组后错位（"main" branch 层被当成 stone object） | C2 cluster |
| **7** | Medium | visible | 不存在端点返回 HTTP 500 INTERNAL_ERROR 而非 404 NOT_FOUND | C2 cluster |
| **8** | Medium | visible | Elysia validation 错误响应嘈杂（>2KB），与 AppServerError `{code,message,details}` 风格不一致 | C2 cluster |
| **9** | Low | visible / persistable | skill_index 暴露绝对路径（应 world-relative） | C1 cluster |
| **10** | Low | collaborable | assistant LLM 第一次 talk_window 调用用错 command='talk'（应该是 'say'） | C1 cluster（与 #5 同源） |

### Round 2 e2e 场景候选（写给 engineering.testing）

```
e2e-1 [observable] resume 不应该产出 failed job
e2e-2 [thinkable] skill_index window 必须把 skills 渲染进 LLM XML
e2e-3 [visible] tree marker 必须打在真正的 stone object 上
e2e-4 [observable] debug endpoint 默认应在 --world baseDir 下查找
e2e-5 [visible] thread API 响应每个 window 应包含 commands 元数据
e2e-6 [observable] paused thread 应携带 pauseProvenance
```

### Round 2 反向 design 反馈

| 反馈 | Supervisor 决策 |
|---|---|
| **#1 visibility-first 在 thinkable 系统性缺口** —— ContextSnapshot 里有的数据，流转到 LLM XML 时被丢弃；render.ts 缺 type-specific renderer 钩子 | **接受**：建议 render.ts 改为 type-dispatch 模式，每个 window type 强制声明 `renderXml(window)`；驱动 C1 cluster |
| **#2 resume 半轮语义时序未定义** —— `patches.resumeSemantics` 只覆盖 "不重跑 LLM"，没规定 "状态翻转 vs job 入队" 先后 | **拍板**：resume 应为 **"标记意图入队 + worker 推进单一通道"**，去掉同步翻状态；写进 `app.server.doc.ts` |
| **#3 stones 新分层（2026-05-21 重组）未在控制面/前端贯通** | 接受作为 known-limitation；当前先修 Issue #6 一处暴露点；整轮 audit 推迟 |
| **#4 AppServerError 与 Elysia native validation 是双错误模型** | **接受**：onError handler 把 ValidationError 压成 AppServerError 形态；驱动 C2 cluster |
| **#5 `/api/runtime/.../debug` endpoint 实际死路** | **拍板**：下线该 endpoint（前端继续走 `/api/tree/file`）；驱动 C2 cluster |
| **#6 三个 AgentOfX 派单方向** | 与 cluster 化对齐 |

---

## Cluster 派单计划（Backlog，等 Supervisor 决策落 meta 后启动）

| Cluster | sub agent | 包含 Issue | 前置条件 |
|---|---|---|---|
| **C1 — thinkable visibility cluster** | AgentOfThinkable | #1 / #5 / #9 / #10 | Supervisor 先写 "window type-specific renderer" 哲学进 meta `thinkable.context.render` |
| **C2 — app server polish cluster** | AgentOfApp(server) | #2（下线 endpoint） / #6 / #7 / #8 | Supervisor 先写 "debug endpoint 下线" + "stones 新分层 audit" 决策 |
| **C3 — observable cluster** | AgentOfObservable | #3 / #4 | Supervisor 先写 "resume 单通道时序" + "pause provenance" 协议进 meta |

---

## 下一轮（Round 3）任务方向

**避开 Round 2 已识别区域**（thinkable render.ts / observable pause-resume-debug / app server tree-marker-error-model / skill_index）—— 这些是 known backlog，不要重复挖。

**新方向候选**（仍由 Round 3 体验官自选 2-3 个深度场景）：

1. **reflectable 自演化闭环**：真的跑一次 super flow → 看反思 thread 写 sediment knowledge → 下轮新 thread 启动是否真的看到新 memory（dogfooding 链路的核心）
2. **collaborable.do_window 跨 thread 协作**：父子 thread 派生、do_window transcript、move 跨 thread 移交、并行调度
3. **programmable 自演化**：metaprog branch 改 server/index.ts → ff merge / cross-scope PR-Issue / supervisor rollback 全链路
4. **visible 前端真实使用**（浏览器视角）：URL routing、ObjectClientRenderer、layout 切换、agent-native UI 双通道一致性
5. **Issue / collaborable 协议**：跨 Object 派 Issue、Supervisor 评审、resolve 路径
6. **knowledge 渐进激活（非 skill_index 路径）**：command path 触发 / open_knowledge 显式打开 / activation_scope 生命周期

---

## Round 3（2026-05-24）— 探索 Issue 协议 / programmable / visible 前端 HTTP

**任务范围**：避开 Round 2 backlog 区域（render / pause-resume / tree-marker-error-model），自选新方向。

**选定场景与评分**：

| 场景 | 维度 | 评分 |
|---|---|---|
| A. Issue lifecycle | collaborable | **OK with sharp edges** |
| B. programmable server-source + call_method | programmable / executable | **Bad** |
| C. visible 前端 HTTP 全程（chat / tree / knowledge route） | visible | **Bad（critical 命名/存储错位）** |

### Round 3 Issue 清单（**均为新 Issue，不与 Round 2 backlog 重复**）

> 状态：均未修复。下一轮体验官请避开。

| # | 严重度 | 维度 | Issue 一句话 | 派单归属 |
|---|---|---|---|---|
| **11** | Critical | visible / persistable | `POST /api/stones/:id/knowledge/files` 把数据写入 `pools/objects/<id>/knowledge/`；route 名与存储语义错位；**无 HTTP route 能写 seed knowledge** | C4 cluster（新增）→ Supervisor 拍板 route 分层 |
| **12** | Critical | programmable / persistable | HTTP 创建 stone / 改 server-source 不入 git；元编程链路丢失版本快照 | C5 cluster（新增）→ Supervisor 拍板 HTTP 写入 vs stone-versioning |
| **13** | High | executable / programmable | ui_methods 完全无沙箱 + 契约 `{ fn }` 不可发现（错误信息仅显示 "entry.fn is not a function"） | C5 cluster；含信任边界 design 决策 |
| **14** | Medium | collaborable | Issue `mentions[]` 不校验对象存在（`createdByObjectId` 校验严格，对称缺失） | C3+ 顺手处理 |
| **15** | Medium | visible / thinkable | `talk_window` 不携带 transcript；frontend 必须 cross-ref `thread.outbox/inbox` 与 `windowId`，约定未在 doc 显式声明 | C1 cluster（与 Round 2 #5 同源新 facet） |
| **16** | Low | app server | 错误响应形态在不同 endpoint 不统一（`/api/runtime/jobs/:badId` 裸 `{code,message}`，其它 endpoint `{error:{...}}` 包络） | C2 cluster（Round 2）+ audit 扩到 onError 全覆盖 |
| **17** | Low | collaborable | 关闭已关闭 Issue 静默幂等，无 `noop` 标记 | C3+ 顺手处理 |

### Round 3 e2e 场景候选

```
e2e-7  [persistable]  stones knowledge HTTP 写入 -> stones/ 而非 pools/
e2e-8  [programmable]  POST /api/stones + PUT /server-source -> stones git log 出现新 commit
e2e-9  [executable]   PUT 含 fs.readdirSync('/etc') 的 server-source -> /call_method 应被沙箱阻止
e2e-10 [collaborable] Issue createIssue mentions 含不存在 object -> 默认 400
e2e-11 [visible]      thread API 的 talk_window 渲染应附带 messages 切片（按 windowId 过滤）
e2e-12 [app server]   错路径 / 不存在 job 走统一 {error:{code,message,details}} 形态
```

### Round 3 反向 design 反馈（**架构级，需要 Supervisor 决策**）

| 反馈 | Supervisor 决策（待） |
|---|---|
| **#7 Pool 引入后 HTTP 路由命名未同步**：`stones/pool/flow` 三分在文件存储层落地，但 HTTP route 仍按旧分类挂在 `modules/stones/`。design 缺"控制面分类追随存储分类"原则。 | **建议 patch** `meta/app.server.doc.ts:modules` 加"route 路径必须反映底层存储 scope（stones vs pools）"；驱动 C4 cluster |
| **#8 Stone-versioning 与 HTTP 写入路径未贯通**：`programmable.method_evolution` 设计了 metaprog branch → PR-Issue → ff merge，但 HTTP `/api/stones` + `/server-source` route **完全绕开**这条路径。 | **待拍板**：HTTP 直写是 design intended（uncommitted working tree 常态）还是 bug（必须走 versioning）？两条路都需在 `app.server.doc.ts:patches` 显式说明 |
| **#9 ui_methods 信任边界未声明**：`executable.server` doc 没讨论 ui_methods 跑在 host 还是 sandbox。`{ fn }` 契约也没显式 schema。有人会无意识 PUT 含 fs/process 调用的代码。 | **待拍板**：信任 stone 作者（保 host capability + 加 GET schema + 文档强调风险）vs 不信任（wrap 进 sandbox + 与 program_window 协议对齐）？ |
| **#10 TalkWindow 不带 transcript 是有意设计还是 render 缺口？** thread-level outbox/inbox + window.id 反向 cross-ref 是合理设计，但没在 doc 显式声明这种契约。 | **建议 patch** `app.client.doc.ts:chat` 加"talk_window 不携带 messages — 必须按 windowId 反向 cross-ref"约定声明；或 thinkable.context.render 加 talk type renderer 把 messages 切到 window（与 C1 同源） |
| **#11 错误模型一致性 vs Elysia 原生**：与 Round 2 Issue #8 同源新 facet——`/api/runtime/jobs/:bad` 走另一条返回路径（裸 `{code,message}`）；onError 包络只覆盖部分错误来源。 | C2 cluster 派单时**全面 audit** onError 覆盖面，不仅 Elysia validation |

### Round 3 新增 Cluster

| Cluster | sub agent | 包含 Issue | 前置条件 |
|---|---|---|---|
| **C4 — route 分层与 storage 语义对齐** | AgentOfApp(server) | #11 / 部分 #15 | Supervisor 写"route 路径反映存储 scope"原则进 `meta/app.server.doc.ts` |
| **C5 — HTTP 写入 vs stone-versioning 决策** | AgentOfPersistable + AgentOfApp(server) | #12 / #13 | Supervisor 拍板"HTTP 直写 vs 必经 versioning" + ui_methods 信任边界 |

---

## 下一轮（Round 4）任务方向

**避开 Round 2 + Round 3 已识别区域**：
- ❌ thinkable.context.render type-dispatch（Round 2 C1）
- ❌ pause / resume / debug endpoint（Round 2 C3 + #2）
- ❌ tree marker / 错误模型（Round 2 C2 + Round 3 #16）
- ❌ stones knowledge HTTP route 错位（Round 3 #11）
- ❌ HTTP stone 写入不入 git（Round 3 #12）
- ❌ ui_methods 沙箱 + 契约（Round 3 #13）
- ❌ Issue lifecycle（Round 3 已覆盖）
- ❌ programmable server-source HTTP（Round 3 已覆盖）

**仍未探索的方向**（推荐 Round 4 自选）：

1. **reflectable 自演化闭环（dogfooding 核心）**：完整跑一次 super flow → 反思 thread 写 sediment knowledge → 下轮新 thread 启动看新 memory
2. **collaborable.do_window 跨 thread 协作**：父子 thread 派生 / do_window transcript / move 跨 thread 移交 / 并行调度
3. **visible 前端浏览器真实视角**（Round 3 只用 HTTP 模拟，未跑浏览器）：URL routing / ObjectClientRenderer / layout 切换 / 真实交互
4. **knowledge 渐进激活（非 skill_index 路径）**：command path 触发 / open_knowledge / activation_scope 生命周期
5. **flow.session_data + ProgramSelf.getData/setData**：session 级数据载体；与 csv-pool 的语义边界
6. **stones git-versioning 全链路**（与 Round 3 #12 同维度但独立 facet）：metaprog branch 创建 / worktree / commit / ff merge / cross-scope PR-Issue / rollback 路径

---

## Round 4（2026-05-24）— 探索 reflectable / collaborable.do / flow.session_data

**任务范围**：避开 Round 2+3 backlog（render / pause-resume / tree-marker / route 错位 / HTTP 不入 git / ui_methods 沙箱 / Issue 协议 / programmable HTTP）。

**🔥 关键提醒**：Round 4 揭示**协议级 dogfooding 缺口**——OOC 自我承诺的"自演化闭环"与"Agent 协作回报"在执行层断裂。**优先级高于 Round 2/3 视觉/路由型 backlog。**

**选定场景与评分**：

| 场景 | 维度 | 评分 |
|---|---|---|
| A. **reflectable 自演化闭环（dogfooding 核心）** | reflectable / persistable.pool | **Bad（critical）** |
| B. **collaborable.do_window 子→父结果回流** | collaborable / executable | **Bad（critical）** |
| C. **flow.session_data + ProgramSelf HTTP 入口** | persistable.flow / executable.server | **Bad** |
| D. knowledge 渐进激活（非 skill_index） | thinkable.knowledge | OK with sharp edges（Round 2 #1 同源新 facet） |

### Round 4 Issue 清单（新 Issue，不与 Round 1-3 backlog 重复）

> 🚨 **#18 / #19 / #20 是哲学承诺级缺口**——超优先级。

| # | 严重度 | 维度 | Issue 一句话 | 派单归属 |
|---|---|---|---|---|
| **🔥 18** | Critical | reflectable / thinkable.knowledge | super reflectable 写出的 sediment markdown **无 frontmatter `activates_on`**——下轮 activator 永不命中，**自演化闭环断裂** | C6 cluster（新）→ AgentOfReflectable |
| **🔥 19** | Critical | collaborable | 子线程在 creator do_window 上**无可发现的 reply 通道**；basicKnowledge 没说"用 continue 回写"；LLM 只能 hallucinate `end({result})` 被静默吞 | C6 cluster |
| **🔥 20** | Critical | collaborable | 子 thread end 后**父侧 do_window 永不 archive**；父被迫 glob+open_file 反向读子 thread.json 取结果 | C6 cluster（与 #19 同源） |
| **21** | High | executable.server / persistable.flow | HTTP `/call_method` 的 `httpContext()` 返回空壳 self={dir:""}；**getData/setData/callCommand 全缺**——flow.session_data 在 HTTP 死路 | C7 cluster（新） |
| **22** | High | executable.server | flows `/call_method` 接到 sessionId 但**没传给 httpContext**；即使补 getData/setData 也无法定位 data.json | C7 cluster |
| **23** | High | executable / root.end | `end` command 仅接受 reason/summary；`args.result` 静默丢弃；KNOWLEDGE 没说明 | C6 cluster |
| **24** | Medium | thinkable.knowledge | activator union **永不包含 `root` 路径**；`show_description_when:[root]` 的 seed knowledge 永不激活 | Round 2 C1 cluster 扩展 |
| **25** | Medium | observable | done thread 后 activation 不持久化；HTTP/前端**无法反推 LLM 当时实际激活了哪些 knowledge**——观测盲区 | Round 2 C1 + observable |
| **26** | Medium | persistable.flow | 初次创建 flow object 时 root thread **立刻入队 run-thread job**（即使无 inbox 消息）；LLM 在空状态下被启动，产生"空 kickoff 幻觉" | AgentOfPersistable / scheduler |
| **27** | Low | reflectable | super reflection prompt 让 LLM 倾向幻觉"past-me repeatedly..."；guardrail 缺失 | C6 cluster |

### Round 4 e2e 场景候选

```
e2e-13 [reflectable]   super 写出的 sediment .md 必须含合法 frontmatter (activates_on)
e2e-14 [reflectable]   跑完 super 后下轮新 thread llm.input.json 必须出现 sediment knowledge path
e2e-15 [collaborable]  子 end 后父侧 do_window 自动转 archived/done
e2e-16 [collaborable]  子线程 LLM input 应在 creator do_window 段明确出现"用 continue 回写"协议
e2e-17 [root.end]      end({result}) 应被 reject 或映射到 summary，不可静默丢弃
e2e-18 [executable.server] POST /call_method 调 self.getData/setData 应落 flows/<sid>/objects/<id>/data.json
e2e-19 [thinkable]     seed knowledge activates_on:[root] 应在 root 阶段激活
e2e-20 [observable]    thread API 响应附加 lastActivatedKnowledgePaths 字段（done thread 也能反推）
e2e-21 [persistable]   POST /api/flows/:sid/objects/:id 不应立即入队 run-thread job (除非 explicit kickoff)
```

### Round 4 反向 design 反馈（**5 条，含 2 条哲学承诺级**）

| 反馈 | Supervisor 决策建议 |
|---|---|
| **🔥 F1 — Reflectable sediment 写出契约缺失（最关键）**：自演化是哲学闭环关键，但执行层没有 schema enforcement——LLM 写啥写啥、frontmatter 全缺，下轮永不激活。看上去能跑通但**第二轮永远复发**——OOC 自演化承诺的根本失守。 | **必须修**：`meta/object.doc.ts:reflectable` 加 "sediment write contract" 节；要求所有 super reflection 写入 .md 含 `activates_on`；reflectable basicKnowledge 强制告诉 LLM，或在 write 入口校验 |
| **🔥 F2 — do_window 双向通道子侧 visibility 失守**：meta 明确"子线程通过 creator window 回报"，但子线程 LLM 看到的 creator do_window 段**只有 transcript，无 reply 协议**；`end({result})` 自然写法被静默吞 | **必须修**：do_window basicKnowledge 拆分父/子视角（基于 `is_creator_window`）；end command knowledge 加"想带结果给父，请改用 creator do_window 上的 continue"；或更彻底——end 加 result 参数自动同步到 creator do_window transcript + auto-archive |
| **F3 — flow.session_data 在 HTTP 入口完全死路**：ProgramSelf 注入 getData/setData 设计在 `httpContext` 实现里彻底缺失（空壳）；前端调 ui_methods 想读写 session 数据全 broken | **待拍板**：HTTP `/call_method` 是否注入完整 ProgramSelf？是→sessionId 透传 + flow-data IO 联通；否→meta 显式标"HTTP ui_methods 不暴露 session_data" |
| **F4 — initial run-thread auto-enqueue 哲学问题**：创建 flow object 立即跑一轮，LLM 在空状态下产生"空 kickoff 反思"幻觉 | **建议**：`meta/persistable.flow` 显式声明"create flow object 不自动 kickoff"；移除 service 自动入队 |
| **F5 — activator union root 路径缺失 + done thread 观测盲区** | 与 Round 2 C1 一起处理：activator 加隐式 path（root + 当前 active window types）；render 时把 activation 结果写入 thread.events `kind=knowledge_activated`，落盘可反查 |

### Round 4 新增 Cluster

| Cluster | sub agent | 包含 Issue | 优先级 |
|---|---|---|---|
| **🔥 C6 — dogfooding 协议补全** | AgentOfReflectable + AgentOfCollaborable | #18 / #19 / #20 / #23 / #27 | **最高**（哲学承诺级） |
| **C7 — HTTP ui_methods 接通 flow.session_data** | AgentOfApp(server) + AgentOfPersistable | #21 / #22 | 高 |

---

## 下一轮（Round 5）任务方向

**避开 Round 2+3+4 backlog**：所有已识别 Issue 区域（含 reflectable / collaborable.do / flow.session_data HTTP / activator root + done observability / initial auto-enqueue）。

**仍未充分探索的方向**（Round 5 自选）：

1. **visible 前端浏览器真实视角**（playwright / 浏览器手工）：URL routing / ObjectClientRenderer / layout 切换 / chat 时间线 / agent-native 双通道（Round 3 仅 HTTP 模拟未碰浏览器）
2. **stones git-versioning 全链路**：metaprog branch 创建 / worktree 隔离 / commit / classifyWorktreeBranch / ff merge / cross-scope PR-Issue / supervisor rollback（Round 3 #12 是 "HTTP 直写不入 git"，这里是 **git 流程本身**的体验）
3. **worker 调度 / jobManager**：job 入队顺序、超时、retry、cleanup；与 thread.status 的双向状态同步
4. **knowledge 渐进激活（file / search / program 等 window）**：非 skill_index、非 talk 的其他 ContextWindow 类型激活路径
5. **启动期 recovery-check 全链路**：故意写 broken server/index.ts → 启动期 [recovery-needed] PR-Issue → resolve 全程
6. **stone client / flow client 双层 UI**（visible 维度的另一面）：stone/<id>/client/index.tsx 与 flow/<sid>/.../client/pages/<page>.tsx 协作

---

## 历史

- **Round 1（2026-05-24）**：验证 stone/pool 简化主干；4 Issue 全部修；产出 3 条设计规范
- **Round 2（2026-05-24）**：横向探索 visible / observable / thinkable；10 Issue + 6 设计反馈 → C1/C2/C3 cluster
- **Round 3（2026-05-24）**：Issue 协议 / programmable / visible HTTP；7 新 Issue + 5 架构反馈 → C4/C5 cluster
- **Round 4（2026-05-24）**：reflectable 自演化 / collaborable.do_window / flow.session_data HTTP；10 新 Issue + 5 反馈，**揭示协议级 dogfooding 缺口** → C6（最高）/ C7 cluster
- **Round 5（计划）**：visible 浏览器视角 / stones git-versioning / worker 调度 / 其他 window 类型 knowledge 激活 / recovery-check 全链路
