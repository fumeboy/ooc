# Supervisor 外循环观察 — 以 claude-code-best 为参照系审视 OOC

**作者**：Supervisor（Claude Code 主会话）
**日期**：2026-05-25
**触发**：用户请求"以 https://github.com/claude-code-best/claude-code 为榜样，结合 OOC 现状做优化"
**性质**：外循环 Round 1 — 哲学比对 + 缺口识别，**未动 src/，未动 meta/*.doc.ts**

---

## 1. 背景：榜样的定位辨识

**claude-code-best (CCB)** 是一个 Claude Code 的「白皮书 + 生产级工程化复刻」项目（[ccb.agent-aura.top](https://ccb.agent-aura.top)）。它把官方 Claude Code 的核心机制拆为 8 类、约 50 篇文档：

1. **Agent Architecture** — Coordinator & Swarm，Sub-agent 权限/生命周期，Worktree isolation
2. **Context Management** — Three-layer compaction（Session Memory / API summaries / MicroCompact），Project memory，Dynamic System Prompt，Token budget
3. **Conversation & Loop** — QueryEngine multi-turn，JSONL transcripts，agentic loop state machine
4. **Extensibility** — Custom agents (Markdown → runtime)，Hooks lifecycle（27 event types / 6 类别），MCP 7 transport，Skills (prompt-as-capability)
5. **Features** — auto dream，daemon，fork subagent，voice mode，workflow scripts (18+)
6. **Internals & Gatekeeping** — 88+ feature flags，GrowthBook A/B，three-tier gating
7. **Safety & Permissions** — Allow/Ask/Deny 三级，Auto Mode 分类器，Plan Mode HITL，Sandbox
8. **Tools & Integration** — File AST-safe，ripgrep + glob，shell read-only detection，Tasks dual architecture

### 关键判定：CCB 不是 multi-agent 哲学创新者

CCB 的价值是**「Claude Code 这类 single-agent CLI 的工程化集大成者」**。它不在 OOC 关心的"对象化上下文 / 8 能力维度协作"层面发明新东西，而是在「一个 agent 跑得久、跑得稳、跑得透明」这件事上做到极致。

因此 OOC 不该把 CCB 当哲学榜样，而该把它当 **工程清单**：
- CCB 已解决的问题，OOC 是不是漏了？
- OOC 已解决的问题（对象化、元编程、stone/flow 三分），CCB 没碰过 — 别照搬退化。

---

## 2. 对照表：OOC 8 维度 vs CCB 8 类

| OOC 维度 | OOC 现状（meta/object.doc.ts） | CCB 对应能力 | 差距 |
|---|---|---|---|
| **thinkable** | ContextWindow + ContextBuilder + ThreadTree + knowledge 渐进激活 | 三层压缩 + Project memory + Dynamic System Prompt caching + Token budget | 🔴 缺**显式 token budget + 压缩策略**；ContextWindow 只增不减（除手动 close） |
| **executable** | tool 原语稳（exec/close/wait）+ command + WindowRegistry | 工具注册 + ripgrep + AST-safe edit + read-only shell detection | 🟡 OOC 不是 CLI，shell 安全不直接对应；但 file_window edit 的 AST safety 可借鉴 |
| **collaborable** | ThreadMessage + talk-delivery + Issue + creator window + relation_window | Coordinator & Swarm + Worktree isolation + Sub-agent permission/lifecycle | 🟡 OOC 的 talk-delivery 是**对象协议，比 CCB 的 prompt-stitching 更高级**；缺 worktree isolation 工程化 + sub-agent permission |
| **observable** | debug 落盘 + LlmObservation + PauseChecker + ContextSnapshot + silent-swallow ban | Langfuse 集成（agent loop UI）+ JSONL transcripts + Sentry | 🟡 visibility-first 哲学已强，缺**可视化 agent loop 浏览器**（Langfuse 等价物） |
| **reflectable** | super_session + memory_layout + 反思必落 memory + 元编程闭环 | /dream 自动整理记忆 + cross-conversation recall | 🟢 OOC 远超 — super flow + 元编程比 /dream 深 |
| **persistable** | stone + flow + pool 三分 + 4 种 ref + stone-versioning（bare repo + worktrees） | （弱，CCB 主要 single-agent） | 🟢 OOC **远超** |
| **programmable** | CommandTableEntry + loader 热更 + ProgramSelf + HTTP 写 stone 经 versioning | Custom agents Markdown→runtime + **Hooks 27 event types / 6 类别** + Skills | 🔴 **缺 Hooks 体系** — OOC 几乎只有 PauseChecker 一个 hook 点 |
| **visible** | React + AppShell + stone/flow client + ui_methods HTTP + agent-native UI（未落地）| （弱，CCB 是 CLI）| 🟢 OOC 远超 |

---

## 3. 完全缺失的横切维度（CCB 有 / OOC 无显式对位）

### 🔴 缺口 A — Safety & Permissions 三级模型
- **CCB**：Allow / Ask / Deny 三级 + Auto Mode（AI 分类器）+ Plan Mode（HITL）+ Sandbox。
- **OOC**：仅 `engineering.harness.doc.ts:role_split` 写了"危险动作走 human-in-the-loop"，**未落到代码层**。
- **风险**：元编程闭环（programmable.metaprogramming）让 Agent 改自己的 server/index.ts；没有 permission 模型 = 一个 bug = 不可逆破坏。

### 🔴 缺口 B — Hooks lifecycle 系统
- **CCB**：27 个 hook event，6 大类别。
- **OOC**：只有 PauseChecker（pre-tool-call 单点）。
- **该归属**：programmable + observable 横切。
- **价值**：让人类与外部系统（CI / Slack / Sentry）能在 thinkloop 关键阶段注入观察与拦截。

### 🔴 缺口 C — 三层 Context Compaction
- **CCB**：Session Memory（整体摘要）/ API summaries（消息级）/ MicroCompact（字段级）。
- **OOC**：ContextBuilder 只是"拼接当前 windows + knowledge"，**无压缩策略**。`executable.tools.todo` 里有 `compress` tool 占位但未实现。
- **风险**：长 thread 撞 token 上限是必然问题，目前隐藏。
- **本文档第二部分将详细设计**（按用户要求）。

### 🟡 缺口 D — Feature flag / Gating
- **CCB**：88+ feature flags + GrowthBook 三层 gating。
- **OOC**：无 runtime gating；stone-versioning 用 git branch 提供 design-time 隔离。
- **判断**：当前阶段不必要；stone 给外部用户时再补。

### 🟡 缺口 E — Pipe IPC / 跨进程协作
- **CCB**：Pipe IPC + LAN 跨机零配置。
- **OOC**：collaborable 局限于同一 server 内。
- **判断**：OOC 的 object 化 talk-delivery 在协议层比 Pipe IPC 高级；缺的只是"跨进程网关"。远景。

---

## 4. Supervisor 拍板：三档优先级

### 🔴 P0 — 哲学边界有空白，需更新 meta/*.doc.ts

| ID | 主题 | 涉及维度 | 派单对象 |
|---|---|---|---|
| P0-1 | Permission 模型（Allow/Ask/Deny + 演化 PauseChecker）| executable + observable | AgentOfExecutable + AgentOfObservable 联合 |
| P0-2 | Context budget + 压缩策略 | thinkable | AgentOfThinkable（本文第二部分先做 design 草稿）|

### 🟡 P1 — 维度本身已含，只是执行层缺口

| ID | 主题 | 涉及维度 | 派单对象 |
|---|---|---|---|
| P1-3 | Agent-loop visualizer（Langfuse 等价物）| observable + visible | AgentOfObservable + AgentOfVisible 联合 |
| P1-4 | Hooks lifecycle 子节点 | programmable | AgentOfProgrammable |

### 🟢 P2 — 远景

- P2-5 跨进程 talk-delivery 网关（CCB Pipe IPC 等价物）
- P2-6 Feature flag / runtime gating

---

## 5. 风险与不该照搬的部分

| CCB 做法 | 不照搬原因 |
|---|---|
| 88+ feature flags | single-agent 复刻副作用；OOC 用 stone-versioning git branch 已覆盖 design-time gating |
| Coordinator/Swarm prompt 工程 | OOC 的 talk-delivery 是 object 协议，倒退就是 prompt-stitching |
| /dream 记忆整理 | reflectable.super_session + memory_layout 已覆盖；照搬等于退化 |
| 27 个 hook event 全量照搬 | OOC 应选 7-10 个有 LLM/系统语义的事件（thinkloop 边界 + tool 边界 + super flow 边界），不复制 CCB 的内部 implementation events |

---

## 6. 下一步（本轮外循环的剩余 step）

1. **本文档**：观察沉淀，已写入 `docs/2026-05-25-ccb-observation.md` ✅
2. **接下来**：按用户要求，**结合 ContextWindow 机制做上下文压缩方案 design** —— 见同日另一份 design doc `docs/2026-05-25-context-compression-design.md`。
3. **再下一步**（待用户拍板）：是否把 P0-2 design 落到 `meta/object.doc.ts:thinkable` 作为新子节点；P0-1 是否同步起草。

---

## Round 1 闭环 — 收尾汇总 (2026-05-25 当日)

P0-2 (Context budget + 压缩策略) 整轮完成；P0-1 / P1 / P2 推迟后续 round。

### 实施轨迹
| Phase | 范围 | 派单 | 产物 |
|---|---|---|---|
| P0a | meta design 落地（context_budget + compress.children）| Supervisor 直写 | `meta/object.doc.ts` 新增 thinkable.context_budget + executable.tools.children.compress |
| P0b | compressLevel 字段 + compress tool (scope=windows) + expand + fallback render + ProcessEvent context_compressed | sub agent | 10 文件改 / 2 新；e2e 1/1 PASS |
| P0c | 4 高频 type 的 compressView (file / search / talk / do) | sub agent (并行 P0d) | 4 文件改；e2e 5/5 PASS, 99 expect |
| P0d | applyNaturalDecay (idle/age/double/cascade) + 配置读取 + ThinkLoop 接入 | sub agent (并行 P0c) | `src/thinkable/context/budget.ts` 新；e2e 6/6 PASS |
| P0e | estimateThreadTokens + applyEmergencyGuard (三波) + ThinkLoop 警告注入 | sub agent (并行 P0f) | budget.ts 扩；e2e 8/8 PASS |
| P0f | events_summary ProcessEvent + compress(scope=events) + `_foldedBy` 渲染过滤 + 持久化保留 | sub agent (并行 P0e) | `compress.ts` + `context/index.ts` 扩；e2e 6/6 PASS |

### 整体校验
- **Compression e2e 集合**：26/26 PASS / 398 expect
- **全仓单测 `bun test src/`**：550 pass / 0 fail / 3 skip
- **`bun tsc --noEmit meta/object.doc.ts`**：clean
- **全仓 tsc**：7 错误，全在 `src/app/server/modules/ui/{api.list-flows,service}.ts`，预存在 baseline 与本次无关
- **session / 进程卫生**：5 个 sub agent 均报告无 long-running 进程残留，无 `.ooc-world/flows/` 污染

### Design ↔ 实现差异 (5 sub agent 协同发现，已回写 design doc)
1. tool args schema 用 snake_case (`target_ids` 而非 `targetIds`) — 与 OOC 现有 tool schema 一致
2. fallback render shape：`<title>` + `<status>` + `<compressed level/>` + `<commands hint="expand">`（比 design 表"仅 title + summary"更详细，便于 LLM 看见自身被压缩 + 怎么 expand）
3. ProcessEvent 实际形态：`{category, kind, ...payload}` 二级结构（与现有 ProcessEvent 体例一致；design 写得扁平）
4. idle-set 包含 `closed`（OOC `WindowStatus` 类型没字面 `"idle"`，`closed` 是各 type 的实际收纳态）
5. 配置文件路径实际是 `stones/<self>/objects/<objectId>/config/context-budget.json`（不是 design 写的 `stones/<self>/config/`；多一层 objects/<objectId> 是 OOC 真实 stone 路径结构）
6. file_window 用 `lines: [start, end]` 字段而非 `read_range`（OOC 现有字段名）
7. `_decayMeta` (P0d) 是 strip 的；`_foldedBy` (P0f) 是 persist 的——同样下划线前缀但反向处理；已在 `thread-json.ts` 顶部加注释说明

### P0-2 不变量校验（5 条全部成立）
| 不变量 | 怎么验证 |
|---|---|
| 可见性 — 每次压缩落 ProcessEvent | 各 phase e2e 都断言 `context_compressed` 或 `events_summary` event 进 thread.events |
| 可逆性 — level≥1 自动挂 expand | P0b e2e 第 4 步：exec(window_id, "expand") 还原 level 0 + 落对应 event |
| type-dispatch 不破 — render.ts 无 switch-by-case | render.ts 调度按 compressLevel → compressView hook，无 type-switch |
| 持久化不丢 — compressLevel 进 thread.json | P0b/P0c e2e 跑了 writeThread→readThread→断言保持 |
| 无幽灵 LLM 流量 — 摘要由 LLM 主动产出 | P0e emergency 路径用 placeholder `"[auto-fold by emergency guard, no LLM summary available]"`；P0f 用户路径 summary 来自 compress 调用 args |

### 工作循环统计
- 外循环 1 轮（Supervisor 主导哲学比对 + design + 收尾）
- sub agent 内循环 5 个（P0b/c/d/e/f 各一），其中 P0c+P0d / P0e+P0f 两组并行
- meta 修改 1 次（Supervisor 直写 + tsc 验证）
- e2e 新增 5 套 26 用例
- 总 sub agent token：~600K（5 sub agent 累计；最大 P0b 140K，其余 100K~120K）

### 残留 / 后续
- **P0-1 (Permission 模型)** — 推迟下一轮；与 P0-2 解耦完成
- **P1-3 (agent-loop visualizer)** — 推迟；现在已有 `context_compressed` / `events_summary` event 进 thread.events，UI 可视化条件已具备，但本轮不做
- **P1-4 (hooks 体系)** — 推迟；compress / expand / natural-decay 都已是 ProcessEvent 流的一员，可视为 hooks 的雏形
- **P2-5 / P2-6** — 远景

### 未在本轮触碰但建议下轮重审的潜在改进
1. `stones-versioning` / `metaprog` 已有 baseline 失败 — 不属本次范围，但建议下一轮 AgentOfPersistable / AgentOfProgrammable 检查
2. `src/app/server/modules/ui/{api.list-flows,service}.ts` tsc 错误是真问题，应派 AgentOfVisible 修
3. compress tool 与 LLM 的真实交互未做真 LLM e2e — 仅机制层验证；下一轮可派 AgentOfExperience 跑一个真 LLM 长 thread 看 LLM 会不会主动 compress

---

## Round 2 闭环 — P0-1 Permission 模型 (2026-05-25 当日)

P0-1 (Permission 模型) Q0a~Q0d 完成；Q0e 列 todo（自改 server/index.ts 硬 deny + stone 作者 permission 声明传递）。

### 实施轨迹
| Phase | 范围 | 派单 | 产物 |
|---|---|---|---|
| Q0a | meta design 落地（executable.permission + 4 个 patches）| Supervisor 直写 | `meta/object.doc.ts` 新增 `executable.children.permission` |
| Q0b | CommandTableEntry.permission 字段 + permissions.ts + PermissionDecider API + thinkloop 接入 + Deny + permission_denied/permission_ask ProcessEvent + policies.json 读取 + e2e | sub agent | 6 文件改 / 2 新；e2e 8/8 PASS (6 场景) |
| Q0c | permission_ask 加 decided/pendingCall + thinkloop resume 路径（approved 重放 + 幂等保护）+ HTTP API /api/runtime/.../permission + decidePermission 短路 + 渲染三态 | sub agent (并行 Q0d) | 5 文件改 / 2 新；e2e 8/8 PASS (4 场景) |
| Q0d | 仓库 commands 全量盘点 + 6 项填 ask（write_file / root.program / program_window.exec / file_window.edit / relation.edit / metaprog）+ 0 项填 deny（列 Q0e）| sub agent (并行 Q0c) | 6 文件改；全仓单测 + 全部 e2e 无补救通过 |

### 整体校验
- **Permission e2e (Q0b + Q0c)**：16/16 PASS (10 场景)
- **联合 e2e (P0-2 5 套 + P0-1 2 套)**：42/42 PASS / 475 expect
- **全仓单测 `bun test src/`**：550 pass / 0 fail / 3 skip / 1634 expect
- **`bun tsc --noEmit meta/object.doc.ts`**：clean
- **session / 进程卫生**：3 个 sub agent 均报告无 long-running 进程残留

### Supervisor 拍板记录（3 项 Q0d 抛回的歧义）
1. **issue.comment** → 保持 allow（与协作主线一致，跨 thread 但 session 内）
2. **custom window Proxy** → 保持 allow，由 stone 作者自行声明 permission（programmable loader 透传——Q0e）
3. **自改 stones/<self>/server/index.ts deny** → 列 Q0e（仓库无单独 command；通过 write_file 路径前缀检查或专用 program_self_modify command 落地）

### Design ↔ 实现差异 (3 sub agent 协同发现，已回写)
1. CommandTableEntry 实际位置：`src/executable/windows/_shared/command-types.ts`（已迁移）
2. policies.json 实际路径多一层 branch：`stones/<branch>/objects/<id>/config/policies.json`
3. observable 反向依赖 executable 不能 — PermissionDecider 类型在 observable 重新声明，permissions.ts 用 alias（干净的依赖反转）
4. HTTP endpoint 路径调整：`/api/runtime/flows/:sessionId/objects/:objectId/threads/:threadId/permission`（按 ref 三元组而非裸 threadId，与现有 runtime 模块风格一致）

### P0-1 不变量校验（6 条全部成立）
| 不变量 | 怎么验证 |
|---|---|
| 向后兼容 — 未声明 permission 默认 allow | Q0d 全仓单测 + e2e 全过，未触发任何 ask/deny |
| 可见性 — ask/deny 必落 ProcessEvent | Q0b/Q0c e2e 断言 permission_ask / permission_denied 落 thread.events |
| 可恢复 — approve 后真正执行 | Q0c e2e 场景 A：approve → dispatcher 被调，命令真正执行 |
| Deny 信息流 — 必写 function_call_output | Q0b e2e 场景 B/C：events 中出现 function_call_output 含 "denied" |
| 配置容错 — policies.json 错误不抛 | Q0b e2e 场景 F：empty/invalid-json/字段拼错 全 fallback |
| silent-swallow ban | 所有 deny/ask 路径均写 event + function_call_output（reject 路径），无静默 |

### 工作循环统计
- 外循环 2 轮（Round 1 P0-2 / Round 2 P0-1）
- sub agent 内循环 8 个（P0b/c/d/e/f + Q0b/c/d）；其中 P0c+P0d / P0e+P0f / Q0c+Q0d 三组并行
- meta 修改 2 次（thinkable.context_budget + executable.permission）
- e2e 新增 7 套 42 用例 / 475 expect
- 总 sub agent token：~960K（累计 8 sub agent）

### 推迟到下轮
- **Q0e** — 自改 server/index.ts 硬 deny + stone 作者 permission 声明传递
- **P1-3** — agent-loop visualizer（context_compressed / permission_* ProcessEvent 已就位，UI 可视化条件已具备）
- **P1-4** — hooks 体系（compress / expand / natural-decay / permission_ask 都已是 ProcessEvent 流的一员）
- **远景** — Auto Mode / Plan Mode / OS Sandbox / 跨进程 talk-delivery / runtime feature flags

### 当前 OOC 安全姿态
- 元编程闭环（programmable.metaprogramming）下，LLM 不能再"无声"修改 self.md / server/index.ts / 写任意文件 / 跑任意 shell——这些全部走 ask
- 控制面（Web UI / CLI）可通过 HTTP POST 实现 HITL approve / reject
- Q0e 落地后元编程边界硬约束完成

---

## 历史

- **2026-05-25**：首版。Supervisor Round 1 外循环。
- **2026-05-25**（当日 Round 1 闭环）：P0-2 完整实施完成，5 套 e2e PASS / 全仓单测 PASS / meta tsc clean。差异与残留如上。
- **2026-05-25**（当日 Round 2 闭环）：P0-1 Q0a~Q0d 完成，2 套 e2e (Q0b+Q0c) PASS / 联合 P0-1+P0-2 42 用例 PASS / 全仓 550 单测 PASS。3 项歧义 Supervisor 拍板；Q0e 列 todo。
- **2026-05-25**（当日 Round 6 闭环）：体验官 Round 5 报告的 6 个 UX/UI/parity/data 问题清零，3 sub agent 并行修复。
  - **Batch A** (AgentOfVisible, 4 UI/UX 修)：
    - H-1 backend offline pill 误报 → MainPanel.tsx 改用真 error 摘要而非误导 "backend offline"；MainLogo 仍是唯一健康度真相源
    - H-2 `/files/<path>` dead link → FileViewer 新增 path+error fallback 卡片 ("File not available" + 用户 path + 后端错误摘要)
    - H-3 user thread no composer → UserThreadHome 空态加 "→ 去 welcome" 按钮；Welcome 读 `?session=` query；SessionCreator 加 `initialSessionId` prop 预填
    - M-3 stones/{user,main}/self 404 噪音 → query.ts 加 `NON_STONE_OBJECT_IDS` 集合 + 一次性 console.warn（silent-swallow ban 合规）
    - 单测增量：FileViewer.test.tsx 3 + query.test.ts 5 = 8 个；web/ 共 79 pass
  - **Batch B** (AgentOfProgrammable + AgentOfVisible, M-4 agent-native parity dogfood)：
    - 写 OOC World **第一份**真 stone client/index.tsx：`.ooc-world/stones/main/objects/supervisor/client/index.tsx`（534 行）
    - 内容：displayName 按 `display_name_from_self_md` 派生 + readme 摘要 + 8 维度卡片（inline）+ knowledge 列表（HTTP API 派生）
    - 设计原则：不跨 stone 边界（不 import web/、不读 meta/object.doc.ts）；用 CSS var fallback 适配主题
    - 新 e2e `tests/e2e/backend/stone-client-parity.e2e.test.ts`（2 pass：supervisor 200 + feedback-tracker 仍 404 哨兵作 todo 提醒）
    - 落地结果：`/api/objects/stone/supervisor/client-source-url` 不再 404，StoneFallback 不再触发；agent-native UI "design-only" 状态被打破
    - ⚠️ stone tsx 在 `.ooc-world/` 下 (gitignored)，fresh world 启动不会自动出现——是否把 supervisor client 升格 World invariant 留下一轮拍板
  - **Batch C** (AgentOfPersistable, M-5 pool sediment 迁移)：
    - 真因诊断：**不是需要迁移数据**，而是 `check-pool-migration.ts` 的判定逻辑过时——把合法 seed knowledge（stone/knowledge/）当 legacy 误报
    - 修：判定从"stones/knowledge 存在"改为"sediment 形态信号 (memory/relations 子目录、files/ 子目录)"
    - 给 supervisor + user 预创 pool skeleton (`.pool.json` marker；idempotent)；ensureSupervisorPool / ensureUserPool 函数化
    - 新增 6 单测 (check-pool-migration.test.ts) 覆盖 seed/sediment 判定 4 种 + 混合 + 空 world
    - 启动 banner 警告消失；`curl pools/objects/supervisor/knowledge` 不再 404
  - **整体校验**：
    - `bun tsc --noEmit`：clean
    - `bun test src/`：**603 pass / 0 fail / 3 skip / 1768 expect**（baseline 589 + 14 新单测）
    - `bun test web/`：**79 pass / 0 fail / 215 expect**（baseline 71 + 8 新）
    - `bun test tests/e2e/backend/`：**54 pass / 0 fail / 8 skip / 527 expect**（含 stone-client-parity 2 pass + route-audit 1 pass + 其余）
    - 总计 **736 tests / 0 fail**
  - **派单效率**：3 sub agent 完全并行（文件域不重叠：web/ + .ooc-world/stones/ + src/app/server/bootstrap/）；累计 ~290K tokens
  - **现在 supervisor 在用户访问 `/stones/main/objects/supervisor` 时看到的不是 fallback 占位，而是 OOC 第一份真 dogfood agent-native UI**

- **2026-05-25**（当日 Round 5 闭环）：AgentOfExperience 首次真用户校准 + 暴露 e2e 假阳性盲区。
  - 派 sub agent 用 Playwright 操作 Web UI 跑 7 场景剧本，深度体验 Round 1-3 全部新功能
  - **关键发现**：
    - 体验官报告 3 CRITICAL：`POST .../permission` 404、`GET .../debug/loops` 404、Loop Timeline 完全不可用
    - sub agent 二次诊断真因：**不是 Elysia routing bug，是 long-running backend 进程漂移**——体验官的 backend 启动时点早于 `96ffb2df` (P0-1) + `68a46b3b` (P1-3) 落地，那个 backend 实例没有这两个 commit 引入的路由
    - 在当前 HEAD 上真启 backend → curl 全部正常（`POST .../permission` 返 409 业务错；`GET .../debug/loops` 返 200 `{"loops":[]}`）
  - **教训沉淀**：
    - e2e 用 `app.handle(new Request(...))` PASS 不等于真 HTTP server 路由通——漏掉"路由真没注册" + "long-running backend 漂移"两类问题
    - Round 1-3 全部 P0-1 + P1-3 e2e PASS 在体验中**对真用户全 404**（虽然 root cause 是 backend 没重启，但暴露了我们的测试方法盲区）
    - 已写 2 个 memory：派单环境前提清单 + e2e 假阳性根源
  - **永久 regression gate 落地**：`tests/e2e/backend/route-audit.e2e.test.ts` 真 `Bun.spawn` 启子进程 + 枚举 15 条 transport URL + 仅 Elysia `NotFoundError` 触发 fail；audit 在临时注释 `.use()` 时**精准报出 2 条 fail**，证明能拦截此类 bug
  - **其他体验发现（未修，列后续 round）**：
    - H-1 backend offline pill 误报（topbar 检测信号源与 sidebar 不一致）
    - H-2 `/files/*` 路由几乎是 dead link（URL 路径参数完全无效）
    - H-3 裸 API 创建 session 后 user thread composer disabled + 缺"去 welcome"按钮
    - M-3 `/api/stones/{user,main}/self` 高频 404 不是 stone object（user 是 ephemeral / main 是分支）但 UI 不停 fetch
    - M-4 `/api/objects/stone/supervisor/client-source-url` 404 — feedback-tracker + supervisor 两个 stone 都没写 client/index.tsx → **agent-native UI parity 缺 dogfood 样例**
    - M-5 pool sediment 迁移未完成（启动 banner 已警告）
  - **现实校准结论**：P0-1 / P0-2 / P1-3 / Round 4 设计与代码层都对，但需要"真启 backend + 真 LLM + Playwright"才能验真用户路径；本轮成为 OOC 第一次"agent-native UI vs 真用户体验"对账的基准
  - 整体校验：`bun test tests/e2e/backend/`：52 pass / 0 fail（含新 route-audit 1 pass）；全仓 src/ 单测仍 589 pass / 0 fail / 3 skip
  - 派单效率：2 sub agent 串行（体验官跑剧本 → 修复 agent 诊断 routing）；体验官产出 27 张截图 + 体验脚本 + 完整报告
  - 产出文件：`docs/2026-05-25-round-5-experience-report.md` + `docs/round-5-experience/` (screenshots + playwright-driver-v2.ts + 原始日志)

- **2026-05-25**（当日 Round 4 闭环）：baseline tsc + e2e 漂移清零。
  - **A 段** ui 模块 tsc 7 错全修：
    - `api.list-flows.ts` 调 `service.listFlows()` 但 service 未实现 → 补 `listFlows()` (返 `<world>/flows/` 目录条目, fallback `{ flows: [] }`)
    - `service.ts` 7 个 `Dirent<NonSharedBuffer>` 类型不匹配 → 显式 import `Dirent` from node:fs + readdir 处加 `as Dirent[]` 断言（路径 1：最小改动）
    - 新增 ui module 单测 3 个 (listFlows: 正常列表 / 不存在 / 空)
    - 决策：listFlows API 不挂 index.ts，保持"行为不变"（漏写实现修补，等需要再 wire）
  - **B 段** stones-versioning.e2e 5 漂移全修：
    - 真因：commit `8799e5bb refactor(world): nest stone objects under stones/{branch}/objects/` 把 stone 布局加 `objects/` 中间层；源代码 (`stoneDir` / `migrateFlatToMain` / `stone-versioning.ts` / `recovery-check.ts`) 全跟上，**但 e2e 测试漏了**
    - 单测 `stone-versioning.test.ts` 已正确用 `objects/` 布局；e2e 与之偏差 = 测试漂移而非源代码 bug
    - 修法：测试 11 处补 `objects/` 中间层 + 1 处 fixture 注释；不掩盖 bug（断言语义 100% 保留）
  - **整体校验**：
    - `bun tsc --noEmit`：**clean（首次全仓 0 errors）**
    - `bun test src/`：**589 pass / 0 fail / 3 skip / 1740 expect**
    - `bun test tests/e2e/backend/`：**51 pass / 0 fail / 8 skip / 516 expect**（含 stones-versioning 8/8）
  - 派单效率：2 sub agent 并行（独立改动文件无冲突）

- **2026-05-25**（当日 Round 3 闭环）：P1-3 Agent-loop Visualizer R0a~R0d 完成。
  - R0a meta 落 `visible.children.loop_timeline` 子节点（含 4 个 patches）+ tsc clean
  - R0b 新增 `GET /api/runtime/.../debug/loops` list-loops endpoint + 6/6 service+HTTP 单测 + LoopMeta 类型复用 LlmLoopDebugMetaRecord
  - R0c 三件套组件（LoopTimeline / LoopEntry / LoopEventBadge）+ ThreadDetailTabs 容器 + MainPanel 接入 + 退化模式 banner + 16/16 单测
  - R0d 三件事（badge 单击跳转 + LoopActionPopover 含 permission approve/reject + events_summary 全文）+ 14/14 新单测
  - 整体校验：全仓 src/ 586 pass、web/ 71 pass、P0-1+P0-2 七套 e2e 42 pass — 总计 699 tests / 0 fail
  - 与 plan 主要差异：events 无 createdAt 用等分启发；emoji 占位（plan 允许）；popover 单文件双 mode 而非分两个 Dialog；forceExpand prop 避免 state 上移
  - 验收指标 §13 全部 10 项 ✓ 达成（含 R0d 新增的跳转 / approve dialog / summary 全文 3 项）

