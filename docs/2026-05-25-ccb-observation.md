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

## 历史

- **2026-05-25**：首版。Supervisor Round 1 外循环。
- **2026-05-25**（当日 Round 1 闭环）：P0-2 完整实施完成，5 套 e2e PASS / 全仓单测 PASS / meta tsc clean。差异与残留如上。

