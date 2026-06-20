# OOC context compress —— 完整总览（背景 / 原因 / 当前状态 / 解决思路）

**性质**：compress 这条线的入口总览，串起背景、动因、设计决策、落地现状与剩余路径。
**设计权威**：对象树 `.ooc-world-meta/.../children/thinkable/knowledge/compress.md`（timeless 设计单一权威）；本文是面向开发者的**叙事 + 状态 + 决策依据**，不重复 compress.md 的设计细节。
**关联 Issue（分阶段细节）**：`2026-06-20-compress-window-method-revival.md`（windows scope）/ `2026-06-20-events-compress-design.md`（events scope）/ `2026-06-20-transcript-into-budget-issue.md`（预算 + 应急兜底）。`2026-05-25-context-compression-design.md` 是被取代的旧方向（compress-as-primitive）。

---

## 一、背景

### 1.1 OOC 的 context 是对象集合，不是字符串

OOC = Object Oriented Context。LLM 看到的不是裸 prompt，而是一组 **ContextWindow 对象**：每个窗 = 某 OOC object 的投影（引用），带**业务数据 data（真相）** + **投影态 win（视角：这一刻怎么看它）** + 可调 **method**。OOP 内核钉死两类 method（对象模型权威 `object/self.md` 核 4/5、context 权威 `context.md` 核 5/6）：

- **window method**：纯函数、只改 win（展示态）、不碰 data、零副作用 —— "调整这一视角怎么看"。
- **object method**：改 data、有副作用 —— "改变真相"。

这条 `data=真相 / win=视角 / window method 改视角` 是后面所有 compress 设计的地基。

### 1.2 为什么需要压缩

context 是稀缺资源（token 预算）。其中 **transcript**（thread 的过程事件 `thread.events` + 与 creator 的对话）随 agent 运行**只增不减**（append-only）。长任务跨多个 job 切片续跑（`scheduler_yielded` → reload），transcript 一路膨胀。若不压缩，终将撑爆模型 context window → 硬失败。Claude Code 用 auto-compaction 解决同类问题。

### 1.3 OOC 的两种视角（决定了压缩怎么设计）

同一 thread 按视角投影成两种窗、读**两份不同数据源**：

- **self 视角**：agent 看自己 —— transcript = `thread.events`（顶层 message 流，`context/index.ts:buildInputItems`）。
- **peer/talk 视角**：creator 看 callee —— transcript = `filterTalkMessages` 出的 **inbox/outbox messages**（`thread/readable/talk-render.ts`），**根本不读 `thread.events`**。

→ 折叠 `thread.events` 天生只影响 self 视角（peer 看 messages）；但 peer 视角有自己的 messages transcript 也要折。两视角各折各的数据源、各持自己的 win。

---

## 二、原因（动因 + 设计决策与依据）

### 2.1 直接动因：文档先行、行为未兑现

compress 长期是"写进退役注释、无人兑现"的承诺。`windows` scope（窗折叠档位 `compressLevel`）先补齐（commit 98ba067f）；`events` scope（折叠历史 transcript）是缺口。而 transcript 无界增长撑爆 context 是真实生产风险。

### 2.2 关键设计决策（含被证伪的前提）

这条线经两轮 grill + 多视角对抗审查，纠正了若干误判，结论沉淀如下：

1. **events 折叠是 window method 改 win，不是 object method 改 data**（用户拍板 393240b7）。折叠态存 `win.summarizedRanges`（视角独立），`thread.events` 一字不改 → **可逆**（这是 OOC 对象化相对字符串-prompt agent 的红利：compaction 不必破坏式重写）。

2. **win 有持久化的家（曾被我误判）**。我一度据"self 门面窗不持久化"误判 win 方案不可行、欲退回改 `thread.events` 的 `events_summary`。用户两点反问证伪：① peer 视角也需 compress；② window 状态有持久化的家。核验确认：**win 随 inline-persisted 类整窗落 `thread-context.json`**（`THREAD_CLASS_ID` 是 `mode:"inline"`）；`win.transient` 只管要不要单独 `state.json`、不影响 inline 窗 win 持久化。这是 `feedback_ooc_simplicity_emergence` 说的"防御本能=bias"实例。

3. **当前折叠态载体是 self 门面窗，能用但是过渡债（OOP 内核重审 + workflow 对抗审查的裁决）**。`exec` 无 `window_id` 时默认目标 = self 门面窗（id=objectId），它正是读出侧读折叠态的窗 → **写读同窗、当前 self compress 工作正常（真 LLM 实证），不是 bug**（workflow 里 purist 抛的"永不生效"被对抗审查自己证伪）。但 self 门面窗职责是身份（self.md），让它扛会话折叠属语义混 + 非持久化要后门 + stone 对象冷启动有丢窗洞。**归宿**：`context.md` 核 9/10 早已规定 self 视角应收敛为"一个自己视角 thread window 持 events+creator 对话、其 win 持折叠态、inline 天然持久化"。

4. **不要贸然把载体挪到 creator 窗**。`self-driven root` thread（如顶层 supervisor）**没有 creator 窗**、只有 self 门面窗；挪过去会回退这类 thread 的折叠能力。self 门面窗是当前唯一普适载体。载体收敛须随 thread-as-object 弧整体做。

5. **应急兜底用瞬态钳制、不用框架代调 compress 持久折叠**。与窗 overflow 同模型（per-round、瞬态、不持久化）→ 不违 `budget.ts` "预算不自动推进档位"；不 mutate 持久态（守"写入自由、agent 主导持久 compress"）；tool-pair 天然安全。

---

## 三、当前状态（已落地）

| 环节 | 内容 | commit |
|---|---|---|
| events compress | `win.summarizedRanges` 通用 window method（compress/expand 按 `scope` 分流）+ 读出投影 + 真 LLM 实证 | `48b285c5` |
| 裁决回流 | `context.md` 3.7 迁移映射补载体现状→归宿 | `929e4b5`(ooc-0) |
| transcript 纳预算 | 估算口径统一、计入 soft-warning（core10 另一半的"预算账"半） | `9376ffd8` |
| 应急兜底 | transcript 越 hard 瞬态钳制（保留后缀、tool-pair 安全） | `53c9d502` |
| 设计权威 | 对象树 `compress.md`（四段结构） | `c7f6358`(ooc-0) |
| Case B 修复 | events 折叠投影**吸附到 tool-pair 安全边界**，防孤儿 tool 块崩 think | `503c933e` + `1e6e0fc`(ooc-0) |
| **Case A 载体收敛** | 折叠态从 self 门面窗收敛到**自己视角 thread 窗**（无 creator 窗概念：一条 thread 一个 thread 窗、creator 对话是其上游通道）；谓词拆 `isSelfThreadWindow`/`hasCreatorChannel`；events-compress 能力归属 thread class；删持久化后门 + 冷启动丢窗洞；跨 job reload e2e gate + 真 LLM 实证 | `feat/context-window-axiom`（Task1-7） |

**能力面**：两 scope（windows 档位 / events 历史折叠）、可逆、视角独立、`keepTail` + `{fromIdx,toIdx}` 两种粒度、**三层防溢出**（agent 主动 compress → soft warning 提示 → emergency 钳制兜底）、tool-pair 安全。折叠态挂自己视角 thread 窗（inline 天然持久化、含 self-driven root）。

**测试**：storybook `L2-COMPRESS-EVENTS`（Tier A 控制面 gate；events-compress 经 thread class 解析 + 错窗边界）+ `context.test.ts`（buildInputItems 端到端：折叠/视角隔离/可逆/预算/应急钳制/Case B，折叠态挂 thread 窗）+ `transcript-clamp.test.ts`（钳制/floor/sanitize）+ `context-compression-p0f-events.test.ts`（**跨 job reload 活 gate**：creator-having + self-driven root + 可逆）+ `real-compress.test.ts`（真 LLM 经 thread 窗 window_id 自压缩，gate `RUN_REAL_COMPRESS_TEST=1`，已实跑 pass）。`bun run verify` 全绿（721 pass）+ storybook gate 绿（64 pass）。

**过渡债已清（2026-06-20）**：原 self 视角折叠态停在 self 门面窗（决策 2.2.3）的语义混 + 写盘后门 + 冷启动丢窗洞——已随 Case A 载体收敛全部消除（折叠态挂 inline 持久化的 thread 窗、后门删、builtin 类冷启动恒注册）。

---

## 四、解决思路

### 4.1 已兑现的设计（机制层闭环）

- **一个 method、两 scope、统一语义**：`exec(method="compress", args={scope})`，windows 改 `compressLevel`、events 改 `summarizedRanges`；`expand` 是逆。稳定原语恒 3 个（exec/close/wait），compress 非原语。
- **折叠 = 读出侧投影**：`projectSummarizedRanges` 把落在某 range 内的连续渲染单元折成一条 agent 自写的 summary，段外原样；不动 events 序列、可逆。
- **预算三层防溢出**：transcript 计入预算账（core10）→ 超 soft 报 `<context_budget_warning>`（含 transcript 占比、指向 compress）→ 超 hard 瞬态钳制（保留最近、tool-pair 安全、插可见 marker）。
- **tool-pair 安全**：provider 层不 sanitize 孤儿 tool_use/tool_result（会被 LLM 拒），故 events 折叠投影前**吸附区段到完整配对边界**（`snapRangesToToolPairs`）、钳制对后缀 sanitize 孤儿 output。

### 4.2 Case A 载体收敛（已落，2026-06-20）

**自视折叠载体已从 self 门面窗收敛到"自己视角 thread 窗"**（`context.md` 核 9/10、`compress.md` Case A）。设计敲定走**统一模型**：无独立"creator 窗"概念——一条 thread 恰好一个 **thread 窗（过程）**，creator 对话是它内建的上游通道（self-driven root 通道为空）。落地清单全兑现：

- 每条 thread（含 **self-driven root**）始终注入自己视角 thread 窗（`init.ts`：creator 通道 data 条件化）；
- 身份门面（self.md）+ agency（object methods）**留 self 门面窗**（POV-keyed `xml.ts`，exec 默认目标不变）——「自己」与「过程」各归各窗；
- 谓词拆 `isSelfThreadWindow`（自视检测，含 root）/ `hasCreatorChannel`（有上游，gate wait/end/protocol/say）——读侧折叠源 + 写侧 exec 命中同一 thread 窗；
- **写侧能力归属**：events-compress 移入 thread class、universal 只留 windows scope（错窗 scope=events 抛错指向 thread 窗）；
- transcript 内容由 thread 窗承载（core10"归属"半 + 已落"预算账"半合璧）；
- 折叠态挂 thread 窗 win（THREAD_CLASS_ID inline 天然持久化）→ self 门面窗持久化后门删、冷启动丢窗洞消失；
- **跨 job（scheduler_yielded → reload）活 e2e gate**（重写 `context-compression-p0f-events.test.ts`，退役 `_foldedBy` 路径；creator-having + self-driven root + 可逆）+ 真 LLM 实证（经 thread 窗 window_id 自压缩）。

设计/计划：`docs/2026-06-20-compress-caseA-thread-window-{convergence,plan}.md`。

### 4.3 不做 / 边界

- 不把 compress 重新做成 tool 原语（旧 2026-05-25 方向，已弃）。
- 不让框架自动推进持久压缩态（auto 兜底只做 per-round 瞬态钳制）。
- 不引入 runtime 另起 summarization call（events summary 由 agent 自写）。
