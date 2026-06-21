# OOC context compress —— 完整总览（背景 / 原因 / 当前状态 / 解决思路）

**性质**：compress 这条线的入口总览，串起背景、动因、设计决策、落地现状与剩余路径。
**设计权威**：对象树 `.ooc-world-meta/.../children/thinkable/knowledge/compress.md`（timeless 设计单一权威，已是 **v2**）；本文是面向开发者的**叙事 + 状态 + 决策依据**，不重复 compress.md 的设计细节。
**当前形态 = compress v2（resize/compress 协议 + fork-summarizer，2026-06-21）**：设计 spec `2026-06-21-compress-v2-resize-protocol-design.md`。它把 compress 从「框架塞的通用 window method（两 scope + expand + 默认表）」升级为**协议**（class 自实现、无默认）、摘要改 **summarizer fork** 生成、应急改 **force-wait + clamp floor**。本文 §三/§四 以 v2 为准；§一/§二 的背景与早期决策保留为历史脉络（被 v2 取代处就地标注）。
**关联 Issue（历史脉络，方法面已被 v2 取代）**：`2026-06-21-compress-v2-resize-protocol-design.md`（**v2 权威 spec**）；`2026-06-20-compress-caseA-thread-window-{convergence,plan}.md`（Case A 载体收敛，v2 前置、仍有效）；`2026-06-20-compress-window-method-revival.md` / `2026-06-20-events-compress-design.md`（v1 windows/events scope，方法面已退役）/ `2026-06-20-transcript-into-budget-issue.md`（预算纳入，仍有效）。`2026-05-25-context-compression-design.md` 是更早被取代的方向（compress-as-primitive）。

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

5. **应急兜底用瞬态钳制、不用框架代调 compress 持久折叠**（v1 决策；v2 已**重定位**为 clamp floor）。与窗 overflow 同模型（per-round、瞬态、不持久化）→ 不违 `budget.ts` "预算不自动推进档位"；tool-pair 天然安全。→ **v2 修订**：clamp 保留但降为 **force-wait 之下的最后兜底**（优雅路径=超 hard 且有在途 compress 时 force-wait 等 summarizer fork 折完；clamp 仅在 force-wait 等不及——无在途/fork 失败超时——时保不崩）。**摘要由 summarizer fork 生成、非 agent 自写**（见 §四 v2）。

---

## 三、当前状态（已落地）

| 环节 | 内容 | commit |
|---|---|---|
| 裁决回流 | `context.md` 3.7 迁移映射补载体现状→归宿 | `929e4b5`(ooc-0) |
| transcript 纳预算 | 估算口径统一、计入 soft-warning（core10 另一半的"预算账"半） | `9376ffd8` |
| 设计权威 | 对象树 `compress.md`（四段结构，已重写为 v2） | `c7f6358`(ooc-0) + v2 回流 |
| Case B 修复 | events 折叠投影**吸附到 tool-pair 安全边界**，防孤儿 tool 块崩 think | `503c933e` + `1e6e0fc`(ooc-0) |
| Case A 载体收敛 | 折叠态从 self 门面窗收敛到**自己视角 thread 窗**（无 creator 窗概念：一条 thread 一个 thread 窗、creator 对话是其上游通道）；谓词拆 `isSelfThreadWindow`/`hasCreatorChannel`；删持久化后门 + 冷启动丢窗洞；跨 job reload e2e gate + 真 LLM 实证 | `feat/context-window-axiom`（Task1-7） |
| **compress v2（resize/compress 协议）** | compress 升为**协议**（class 自实现、无通用默认表）：`resize` 设档位（替代 expand）+ `compress` 无参意图；删 `default-window-methods`/`expand`/`scope`；内容窗 opt-in `displayResize` | `36b429eb` + `3e37149a` |
| **compress v2（fork-summarizer + 兜底）** | 摘要由 **summarizer fork** 生成（单轮、无工具、harvest 记 `summarizedRanges`）；**auto-trigger**（未总结 transcript 超 `autoCompressLevel` 阈值 → 自动折）；**force-wait + clamp floor**（超 hard 等在途 fork / 失败时 clamp 保底）；测试待修 + 退潮 | `0d135fb2` 等 |

**能力面（v2）**：`resize`（设档位：内容窗 compressLevel 展示详略 / thread 窗 autoCompressLevel 自动压缩阈值）+ `compress`（无参意图 → 框架 fork summarizer 折早期历史）；协议化（class 自实现、无默认）；摘要 fork 生成；视角独立、可持久；**三层防溢出**（agent 主动 compress / auto-trigger 阈值 → force-wait 等在途 fork → clamp floor 兜底）；tool-pair 安全；折叠态挂自己视角 thread 窗（inline 天然持久化、含 self-driven root）。

**测试（v2）**：storybook `L2-RESIZE-DISPLAY`（内容窗 displayResize + no-default）+ `L2-COMPRESS-V2`（compress=intent/resize=autoCompressLevel + 阈值映射 + projectSummarizedRanges）+ `compress-v2.test.ts`（autoCompressThreshold/shouldAutoCompress/harvestSummarizerForks done/running/failed/orphan）+ `real-compress-v2.test.ts`（真 LLM：spawnSummarizerFork → 单轮 think → harvest 记段，gate `RUN_REAL_COMPRESS_TEST=1`，已实跑 pass）+ `context-compression-p0f-events.test.ts`（**跨 job reload 载体 gate**：summarizedRanges + inFlightCompress 直写持久；creator-having + self-driven root + in-flight）+ `transcript-clamp.test.ts`（clamp floor/sanitize）。`bun run verify` 全绿 + storybook gate 绿（64 pass）。

**过渡债已清**：v1 的 self 门面窗折叠载体（语义混 + 写盘后门 + 冷启动丢窗洞）随 Case A 消除；v1 的两 scope/expand/默认表/agent 自写摘要随 v2 退役（见 `compress.md` §3.8 迁移映射）。

---

## 四、解决思路（v2）

### 4.1 v2 机制（已落地闭环）

- **compress 是协议，不是框架默认**：`resize`（设档位，替代 expand 升降合一为滑杆）+ `compress`（无参折叠意图）两个 window method，各 class 在 readable 自声明、无通用默认表（`resolveWindowMethod` 无回退）。内容窗 opt-in `displayResize` 设 compressLevel；thread 窗 `threadResize` 设 autoCompressLevel、`threadCompress` 置 compressIntent。稳定原语恒 3 个（exec/close/wait），compress/resize 非原语。
- **window method 纯函数、副作用走 framework hook**：方法只置态/意图（spawn fork 不进 window method）；thinkable 框架 hook 见 compressIntent / 超阈值即 spawn summarizer fork。
- **摘要由 summarizer fork 生成**（镜像 Claude Code full-compact Fork Agent）：`spawnSummarizerFork` 复用 execFork，seed 早期 transcript 段 + 「直接输出摘要正文、无工具」，单轮 think 出摘要即 done；`harvestSummarizerForks`（scheduler 每 tick 顶部）读 `child.endSummary` → `win.summarizedRanges += {fromIdx,toIdx,summary}` → 清 inFlight → 唤醒 parent。summarizer fork 标 `isSummarizer`、不进 parent 会话（`emitChildEndNotifications` 跳过）。
- **auto-trigger（阈值驱动）**：每轮 think 估算未总结 transcript token；`compressIntent` 或 `transcriptTokens > threshold(autoCompressLevel)` 且无在途 → spawn fork 折早期段。**transcript-gated**（只看 transcript、不看 windows，避免 windows 主导超限时 livelock）。
- **force-wait + clamp floor（超 hard 兜底）**：超 hard 且有在途 compress → parent 进 waiting 等 fork 折完（无损）；force-wait 等不及（无在途/fork failed/orphan）→ clamp floor 对 transcript per-round 瞬态钳制（保后缀、tool-pair 安全、插可见 marker）保不崩。harvest 端 failed→关本窗自动压缩防 livelock、orphan→清 inFlight 解死锁。
- **tool-pair 安全**：provider 层不 sanitize 孤儿 tool_use/tool_result，故 events 折叠投影前**吸附区段到完整配对边界**（`snapRangesToToolPairs`）、clamp 对后缀 sanitize 孤儿 output。

### 4.2 Case A 载体收敛（v2 前置，已落 2026-06-20）

**自视折叠载体已从 self 门面窗收敛到"自己视角 thread 窗"**（`context.md` 核 9/10、`compress.md` Case A）。统一模型：无独立"creator 窗"概念——一条 thread 恰好一个 **thread 窗（过程）**，creator 对话是它内建的上游通道（self-driven root 通道为空）。要点：每条 thread（含 self-driven root）始终注入自己视角 thread 窗；身份门面（self.md）+ agency 留 self 门面窗；谓词拆 `isSelfThreadWindow`/`hasCreatorChannel`；折叠态挂 thread 窗 win（THREAD_CLASS_ID inline 天然持久化）→ 后门删、冷启动丢窗洞消失。设计/计划：`docs/2026-06-20-compress-caseA-thread-window-{convergence,plan}.md`。

### 4.3 不做 / 边界

- 不把 compress 重新做成 tool 原语（旧 2026-05-25 方向，已弃）。
- 不设通用默认 resize/compress 实现——协议由各 class 自实现（不声明=不可压缩）。
- 不让 agent 手写 events 摘要——摘要由 summarizer fork 生成（v1 的 agent 自写已退役）。
- 不删 clamp floor——它是 force-wait 之下的同步保底（fork 失败/超时仍保不崩）；删 clamp 推迟到 force-wait 生产实证后单独决策。

### 4.4 剩余开放项

- **talk 窗 compress 精度/走向**（`compress.md` Case E）：talk 窗 compressLevel 真有展示意义 + summarizedRanges 折 messages 段；首版优先 self-view thread 窗主路，talk 窗 compress 走 fork-summarize over messages 还是显式段、坐标用 messages 数算总长——实现期定，不挡主路。
