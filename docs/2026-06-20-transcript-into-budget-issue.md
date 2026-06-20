# Issue: transcript 纳入 budget —— 兑现 core10 另一半 + auto/emergency 兜底的根

> 来源：events compress 落地后（`docs/2026-06-20-events-compress-design.md`）从 OOC OOP 内核重审 + 多视角对抗审查得出的唯一"安全独立先做"项。
> 性质：设计已定（context.md 核心 10）、代码未兑现的真实欠债——且是 transcript 无界增长撑爆 context 的根因。

## 1. 现状（已核验）

context.md 核心 10 / 3.5 明文：thread event + 与 creator 的对话是**自己视角 thread window 的内容通道**，"一并纳入 context 预算、可被该窗 compress（消除了'窗之外的 message 流'这一无预算归属特例）"。context.md cases 段甚至已把它标为"已由核心 10 解决、不再是开放 gap"——**但这是设计上解决，代码没兑现**：

- `thinkable/context/pipeline.ts` `ContextPipeline.run` 经 `BudgetManager.allocate(ctx.windows, thresholds.hard)` 只对**窗**分配预算（超额窗进 `overflow`、`<context_overflow>` 呈现）。
- `thinkable/context/index.ts` `buildInputItems`：系统 XML 由 budget 分配后的 `snapshot.windows` 渲出；**transcript（`thread.events` 经 `projectSummarizedRanges` 平铺）在其后无条件追加进 `input[]`**，完全不过 budget。
- soft-warning 的 `currentTokens = estimateWindowsTokens(snapshot.windows)` **不含 transcript**——transcript 再大也不触发警告。

**后果**：events 是 append-only、只增不减；`compressLevel`/`summarizedRanges` 都要 agent 主动 compress 才动。agent 一直不主动压缩 → transcript 无界增长、且连 soft-warning 都不报 → 终将撑爆模型 context window → 硬失败（LlmTimeoutError / context-length）。这既是 core10 未兑现的另一半，也是**缺 auto/emergency 安全网**的根：没有 transcript 的 token 账，就没有"逼近上限自动兜底"的支点。

## 2. 范围（独立安全，不依赖 thread-as-object 弧收敛）

把 transcript 的 token 成本纳入预算口径——**只补账，不动渲染通道**（transcript 仍走 message 流、不塞进 XML 窗）：

- **估算**：复用 `budget.ts` 的启发式（JSON 长度 / 4），对 transcript 的 input items（或其来源 `thread.events`）估 token。口径与 `estimateWindowTokens` 统一，避免漂移。
- **计入 soft-warning**：`buildInputItems` 里 `currentTokens` 改为 `estimateWindowsTokens(snapshot.windows) + 估算的 transcript token`，使警告反映真实占用、提示 agent `compress(scope=events)`。
- **hard 口径**：transcript 是 message 流主叙事、**不能像窗那样被 overflow 踢掉**（它必须渲染）。故 hard 侧的可行杠杆不是"丢 transcript"，而是后续 auto/emergency：transcript token 超阈时由**框架代 agent** exec `compress(scope=events, keepTail=N)`（复用已有 window method、非新原语）。本 Issue 只做**账 + 警告**；auto 自动触发是其上的后续项（依赖本 Issue 先有账）。

## 3. 与其他线的关系

- **core10 另一半**：本 Issue 是"transcript 纳入预算"这半；另一半"折叠态归属/transcript 内容由自己视角 thread window 承载"属 thread-as-object 弧收敛（见 context.md 3.7 迁移映射 + `docs/2026-06-20-events-compress-design.md` §9）。两者可解耦——纳预算不需先收敛。
- **auto/emergency**：本 Issue 是其前置（先有 transcript 账，才能定义"超阈触发"）。
- **不做**：不挪折叠载体（self 门面窗当前能用、贸然挪到 creator 窗会回退 self-driven root）；不做 auto 自动 mutate（后续，gated on 本 Issue）。

## 4. 验收

- `buildInputItems` 的 soft-warning current token **含 transcript 估算**（构造多/大 events thread → 警告按真实占用触发）。
- 单测：events 体量大的 thread → `currentTokens` 显著高于仅窗口估算、越过 soft 阈值触发 `<context_budget_warning>`。
- `bun run verify` 全绿。

## 5. 纪律

- 复用既有估算口径，不新增名词/机制（克制熵增）。
- 中间态打破存量测试只登记账本、统一跑绿。
- 不要自己 commit（交回 Supervisor 整合）。

## 6. 落地结果（2026-06-20，Supervisor 整合）

按 §2 范围落地，与设计一致（无偏差）：

- `thinkable/context/budget.ts` 新增 `estimateTranscriptTokens(items)`——与 `estimateWindowTokens` 同口径（JSON 长度 / 4），口径统一不漂移。
- `thinkable/context/index.ts` `buildInputItems`：`currentTokens = estimateWindowsTokens(snapshot.windows) + estimateTranscriptTokens(transcript)`——transcript 计入预算账。
- `buildBudgetWarningItem` 增 `transcriptTokens` 参数：`<context_budget_warning>` 暴露 `transcript="…"` 占比；建议文案指向正确杠杆——窗口可 `close`，transcript（历史叙事）不能 close、只能 `exec(method="compress", args={scope:"events", keepTail:N, summary:"…"})` 折叠。
- 未做（保持范围）：未挪折叠载体；未做 auto 自动触发（后续，gated on 本 Issue）；transcript 仍走 message 流渲染通道（只补账、不改通道）。

测试：`thinkable/__tests__/context.test.ts` describe「transcript 纳入 budget」3 例（estimateTranscriptTokens 随量增长 + 小体量无警告 + 大 transcript 仅 events 即顶过 soft、warning 含 `transcript=` 且指向 compress）。`bun run verify` 全绿（714 pass）+ storybook gate 绿（64 pass）。

## 7. auto/emergency 兜底（已落地，2026-06-20）

派单原设想"框架代 agent exec `compress` 持久折叠"。落地时改为**瞬态钳制**（Supervisor 裁决，理由见下），更安全、更贴 OOC 哲学：

**实现**：`thinkable/context/transcript-clamp.ts` `clampTranscriptToBudget(items, budget)` + `buildInputItems` 接线——`currentTokens > hard` 时把 transcript 钳到 `(hard - 窗口估算)` 内（丢最早、留最近后缀），插一条可见 `[context_change:context_clamped]` marker 指向 `compress(scope=events)`。

**为何瞬态钳制而非框架代调 compress（持久折叠）**：
- **与窗 overflow 同模型**：窗超 hard 由 `BudgetManager.allocate` per-round 踢进 overflow（瞬态、不持久化）；transcript 钳制是其等价物。不违 `budget.ts` "预算不自动推进档位"（那是持久压缩态；钳制是渲染期 per-round）。
- **不 mutate 持久态**：不写 win/不改 `thread.events`/不生成 lossy 占位摘要——守"写入自由、agent 主导持久 compress"（agent 仍可、且应主动折叠；钳制只是防撑爆的安全网）。
- **tool-pair 安全天然**：钳制保留后缀，function_call 必在其 output 前 → 只可能孤儿 output（call 在被丢前缀），sanitize 丢之即可；provider 层（`claude-transport.ts`）不 sanitize 孤儿 tool_result，必须在此堵住。比持久折叠任意区段（可能切断配对）安全。
- **可逆**：纯本轮渲染影响，agent 一旦主动 compress、钳制即不再触发。

**测试**：`transcript-clamp.test.ts`（钳制/floor/tool-pair sanitize 单元）+ `context.test.ts`「应急兜底」（越 hard → marker + transcript 钳短 + `thread.events` 不动）。verify 全绿（725 pass）。

**剩余后续**：
- **transcript 内容由自己视角 thread window 承载**（core10 另一半的"归属"半）：随 thread-as-object 弧收敛（见 context.md 3.7 + `docs/2026-06-20-events-compress-design.md` §9）。
