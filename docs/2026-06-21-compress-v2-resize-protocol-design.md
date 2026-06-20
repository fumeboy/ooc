# compress v2 —— resize/compress 协议 + fork-summarizer 自动压缩（设计 spec）

**状态**：设计敲定（用户三轮 grill 锁定方向 + 三路代码核验），待 review → 分增量实现。
**性质**：把 compress 从「框架塞的通用 window method」升级为**协议**；引入 fork-summarizer 自动压缩，废除应急 clamp。是 compress v1（Case A）之上的大重构。
**前置**：Case A 已落（自视折叠载体收敛到 thread 窗、`win.summarizedRanges` 载体 + 读侧投影）。本设计 supersede v1 的方法面（compress/expand/scope + 通用默认层 + 应急 clamp）。

---

## 一、目标与锁定决策（用户拍板）

1. **compress 是协议**：ooc class/object 在自己的 readable 实现，不存在通用默认实现。
2. **`resize`**：协议方法，**设 compressLevel（信息展示等级）**，替代 `expand`。class 自实现 + 自定义描述，**无默认**。
3. **`compress`**：协议方法，**无参意图**「我要压缩信息」（class 可自决加可选参），class 自实现，**无默认**。与 resize 是**两个场景**（resize=展示偏好；compress=context 过大需压信息）。
4. **thread 窗（过程增长型）**：compressLevel = **自动压缩阈值**（未总结 transcript 长度 > 该档位阈值 → 自动压缩一次）。
5. **摘要由 fork sub thread 生成**（镜像 Claude Code full-compact 的 Fork Agent），**结构 fork 自决，协议不规定**。生成后记 `win.summarizedRanges{fromIdx,toIdx,summary}` + summarized index。
6. **废除应急 clamp**（v1 的 transcript-clamp）。改为：**context 已超 hard + 存在 compress-ing 的窗 → 强制等待 compress 完成**（无损，不丢数据）；超且无在途 → 先触发 compress 再等。

---

## 二、机制设计（锚定真实代码）

### 2.1 两个协议方法（都是纯 window method，readable 声明，无默认）

WindowMethod 契约是纯函数 `(ctx, self, before_win, args) => 新 win`，**只动 win、零副作用**（`core/readable/contract.ts:51-61`）。故 spawn fork 这种副作用**不能进 window method**——方法只置「态/意图」，副作用由 framework hook 执行。

- **`resize`**（纯）：设 `win.compressLevel`（替代 expand 的 −档 + 旧 compress 的 +档，改为**直接设档位**的滑杆）。
  - 内容窗（file 等）：compressLevel = 展示详略（`xml.ts:projectByCompressLevel` 0 全文/1 缩略/2 句柄）。
  - thread 窗：compressLevel = **自动压缩阈值档**（self-view 渲成句柄，compressLevel 不影响展示，故复用为阈值，`conversation-render.ts:47-60` 确认 self-view 走 handle 分支）。
- **`compress`**（纯，parameterless intent）：thread 窗实现 = **置 `win.compressIntent=true`**（请求折一次）；framework hook 见此 intent 即 spawn summarizer fork。其他 class 可自实现别的 compress 语义或不实现。

**声明位置**：`builtins/agent/children/thread/readable/index.ts` 的 `window[]`（thread/talk/reflect_request 三投影）的 `window_methods` 挂 `resize` + `compress`（取代现 `threadCompress`/`threadExpand`）。`resolveWindowMethod`（`object-registry.ts:196-204`）沿 class window[] 查到即用；**删除通用默认表回退**（见 §四）。

### 2.2 summarizer fork（framework 机制，复用 execFork）

复用 `execFork`（`builtins/agent/children/thread/index.ts:69-117`，programmatic 可调；child 在同 job 的 scheduler loop 内跑，`scheduler.ts:131` collectRunningThreads 含 children）。

- **spawn**（framework `spawnSummarizerFork(parentThread, fromIdx, toIdx)`）：
  - 经 fork 机制建一条 child thread（同 session/object，`_parentThreadRef` 指 parent）。
  - **seed**：把 parent `thread.events[fromIdx..toIdx]` 序列化进 child 初始 inbox message + 指令「把这段过程浓缩成简洁摘要，只输出摘要正文」。
  - 标记：parent `win.inFlightCompress = { forkThreadId, fromIdx, toIdx }`。
  - child class 标记为 summarizer（如 child.data.isSummarizer 或 inFlightCompress 反查），使 harvest 能识别、且其结果**不进 parent 会话**。
- **child 跑**：单轮 think（`thinkloop.ts:360`）读 inbox 的早期 transcript → LLM 产摘要 → end（result=摘要 / 或末条 assistant text 即摘要）。
- **harvest**（framework，scheduler child-end 处，`scheduler.ts:61-88` emitChildEndNotifications 邻接）：child 完成（status=done）且是某 parent 的 `inFlightCompress.forkThreadId` → 读 child 摘要输出 → parent `win.summarizedRanges += {fromIdx,toIdx,summary}`（`_shared/utils/summarized-ranges.ts:addSummarizedRange`）→ 清 `win.inFlightCompress` → 经 inbox 通知唤醒 parent（复用 child-end 通知）。摘要**不作为 peer 消息进 parent 会话**（summarizer 是内部 fork）。

> 载体 + 持久化：`win.summarizedRanges` / `win.inFlightCompress` 随 THREAD_CLASS_ID inline 整窗落 thread-context.json（`thread-persist.ts:66-88`），跨 reload 存活。

### 2.3 auto-trigger（thinkloop hook）

`think()`（`thinkloop.ts:360`）在 `buildInputItems`（:380）之后、LLM call（:397）之前，加一个 framework hook `maybeTriggerCompress(thread)`：
- 找 self-view thread 窗（`isSelfThreadWindow`）。
- 估算其未总结 transcript token（`budget.ts:estimateTranscriptTokens`，扣掉已折段）。
- 若 **(win.compressIntent OR 未总结 token > threshold(win.compressLevel))** AND **无 win.inFlightCompress** → `spawnSummarizerFork(thread, 0, lastIdxBeforeTail)` + 清 compressIntent。
- threshold(compressLevel) 映射见 §三。

### 2.4 force-wait（替代 clamp）

`think()` 入口（:362，`buildInputItems` 之前）加：
- 若 `win.inFlightCompress` 存在（compress 在途）AND context 已超 hard（当前 currentTokens > hard，用 budget 估算）→ parent **进 waiting**（`thread.status="waiting"` + `inboxSnapshotAtWait` + `waitingOn="compress:"+forkId`），return 本轮。
- summarizer fork 完成 → harvest 写 parent inbox → `wakeWaitingThreadsOnInbox`（`scheduler.ts:96-108`，inbox 增长唤醒）→ parent 下轮 think 重 render，已折叠、未超 → 正常跑。
- 若超 hard 但**无**在途 compress → 先 `spawnSummarizerFork` + 进 waiting（与 auto-trigger 合流）。

> 复用现有 waiting/wakeup（inbox 增长唤醒），无需改 scheduler 核心；只在 think 入口加 force-wait 判定 + child-end harvest 写 inbox。

---

## 三、compressLevel → 阈值映射（thread 窗）

compressLevel 0/1/2（resize 设），thread 窗映射为未总结 transcript 的 token 阈值（越高档 = 越激进 = 越低阈值）：

| compressLevel | 语义 | 阈值（未总结 transcript token） |
|---|---|---|
| 0（缺省） | 不主动自动压缩（仅 force-wait 超 hard 时兜底触发） | = hard（仅超 hard 才触发） |
| 1 | 适度 | = soft |
| 2 | 激进 | = soft / 2 |

> 数值锚 `budget.ts` 现有 soft/hard（soft≈100K 字符、hard≈180K）。阈值用 transcript 估算口径（`estimateTranscriptTokens`）。具体常数实现期定、可配置（mirror CC「有效窗−缓冲」）。compressLevel 0 仍受 force-wait 兜底保护（超 hard 必触发），故「不主动」不等于「会撑爆」。

---

## 四、废除/取代（退潮，与实现同步）

| 废除/取代 | 取而代之 |
|---|---|
| `core/readable/default-window-methods.ts`（通用 compress/expand） | 删除；`resolveWindowMethod` 去掉默认表回退（`object-registry.ts:203`）→ class 不声明即无该方法 |
| `builtins/.../thread/readable/compress-events.ts`（threadCompress/threadExpand + scope） | 删除；thread class 声明 `resize`（设 compressLevel）+ `compress`（置 intent）|
| `scope` 参数（windows/events）全链 | 消失：resize=档位、compress=意图、内容窗 vs thread 窗由 class 自实现区分 |
| `core/thinkable/context/transcript-clamp.ts`（应急瞬态 clamp）+ buildInputItems 调用点 | 删除；改 force-wait（§2.4） |
| agent 自写 summary（v1 compress 带 summary 参） | fork sub thread 生成 |
| **保留** | `win.summarizedRanges` 载体 + `projectSummarizedRanges` 读侧投影 + budget 估算（soft warning 去留见风险） |

---

## 五、风险与边界（实现期逐一钉）

1. **window method 不能 spawn fork**（已解）：compress 只置 intent，hook spawn。✓
2. **summarizer fork 自身可能超 budget**：它只 seed「被折的早期段」（非全 context），单轮 input 大→output 小（compaction 本质）。可接受。若该段本身超 hard：实现期定（截断 seed / 分批）——首版**单段**、过大段不再细分（log 标注）。
3. **orphan in-flight**：server crash 后 `win.inFlightCompress` 残留 + fork 丢。harvest 端加：fork 不存在/failed → 清 inFlightCompress（解除 force-wait 死锁）。bootstrap 重入（`worker.ts` enqueueRunningThreadsAtBootstrap）兜底。
4. **多段/链式压缩**：首版**一次一段、不链式**（无 in-flight 才触发）。一段折完仍超 → 下轮再触发下一段。
5. **summarizer 结果污染会话**：harvest 直接读 fork 输出记 summarizedRanges，**不**走 say→parent 会话；fork 标记 isSummarizer，child-end 通知对 summarizer 用内部 marker（不渲进 LLM 会话）。
6. **soft warning 去留**：v1 的 `<context_budget_warning>`（提示 agent compress）——v2 有 auto-trigger，warning 可留作可见信号（silent-swallow-ban）或弱化。首版**保留**（指向「resize 调档位 / compress 手动触发」），不与 auto 冲突。
7. **force-wait 与 fork 同 job**：fork 在同 scheduler loop 跑，parent waiting 后 scheduler 选中 fork（running）→ fork 完成 → harvest 唤醒 parent。同 job 内闭环，不需额外 job。验证：多 tick 内完成（maxTicks 15-20 足够）。
8. **self-driven root**（无 creator 窗）：其 self-view thread 窗（Case A 空通道）同样有 win，resize/compress/auto 一视同仁。
9. **peer/talk 窗的 resize**：talk 窗 compressLevel 真有展示意义（整窗档位）+ summarizedRanges 折 messages 段——talk 窗保留 resize（设档位）+ compress（折 messages，可经 fork 或保留显式，首版：talk 窗 compress 也走 fork-summarize over messages，或暂只 resize；实现期定，**优先保证 self-view thread 窗主路**）。

---

## 六、增量顺序（喂给 writing-plans / 实现）

1. **协议方法落地（无 fork）**：thread readable 声明 `resize`（设 compressLevel）+ `compress`（置 `win.compressIntent`）；`ThreadWin` 加 `compressIntent?`/`inFlightCompress?`；删 compress-events.ts、default-window-methods.ts、`resolveWindowMethod` 默认回退、scope。中间态登坏测试。
2. **summarizer fork 机制**：`spawnSummarizerFork` + seed + child summarizer 标记 + harvest（scheduler child-end 处记 summarizedRanges + 清 inFlightCompress + 唤醒）。
3. **auto-trigger hook**：thinkloop `maybeTriggerCompress`（threshold/intent → spawn）。
4. **force-wait**：thinkloop 入口（超 hard + in-flight → waiting）；删 transcript-clamp + 调用点。orphan 清理。
5. **统一修测试 + 新 gate**：单元（resize/compress 协议解析、threshold 映射、harvest 记 summarizedRanges、force-wait 状态机）+ 跨 job reload（in-flight/summarizedRanges 持久）+ 真 LLM（自动压缩端到端：撑大 transcript → auto fork → 折叠 → 继续）。
6. **退潮 + 文档**：删死码（clamp/default/compress-events/scope 全链 + v1 残留）;compress.md/context.md 重写（compress 升为协议、resize、fork-summarizer、force-wait、删 scope/clamp）;docs/ overview;push ooc-0。

**验收**：`bun run verify` 全绿 + storybook gate 绿 + 真 LLM 自动压缩端到端 + 跨 job reload 不丢。不破坏 fork/talk/wait/peer/持久化/Case A 自视折叠。

**工作方式**：中间增量打破存量测试只登记账本、源码改完统一跑绿（动核心 thinkloop/scheduler，每增量后 `check:tsc` 必过、尽早回绿）。

---

## 七、对抗审查发现与设计修订（2026-06-21，code-grounded）

派 ce-adversarial-document-reviewer 对锚定真实代码 stress-test，结论重塑了若干承重决策。逐条修订：

### C1（核验出真相，非阻塞）—— in-job fork child 机制
- initContextWindows **不为 in-job fork child 调用**（仅 `service.ts:616`/`talk-delivery.ts:161`/`thread-persist.ts:245` 三处）；execFork（`thread/index.ts:69-117`）只 `injectMemberWindowsIfObjectThread`、不造 creator 自视窗。
- **但 fork child 确实在同 job 的 scheduler loop 跑到 done**（`do-fork-and-collect.integration.test.ts` 真 LLM 实证）。parent **醒来靠 `emitChildEndNotifications`**（`scheduler.ts:61-88` 扫 `childThreads` 中 done child → 写 parent inbox → `wakeWaitingThreadsOnInbox` 唤醒），**不依赖 creator 窗 / end→say**。
- child `end({result})` 在无 creator 窗时 result 被丢（`end.ts:113-121`），但 `endSummary`/末条 assistant text 仍在 child 上 → **summarizer 摘要直接从 child harvest**（读 child.endSummary / 末条 text），不走 say。
- **结论**：summarizer fork 机制可行；唤醒 = emitChildEndNotifications（childThreads-based），摘要 = 直接从 child 读。

### C2（CRITICAL，修）—— harvest 与现有 child-end 写入冲突
`emitChildEndNotifications`（`scheduler.ts:61-88`，每 tick 顶部、对所有 done child 无条件写 `[child:<id>:done@..]` marker 到 parent inbox）+ `end→autoReplyTalk→say`（`method.end.ts:62-123`）+ `worker.ts:syncCrossObjectCalleeEnds` 三处会写/污染 parent。**修**：summarizer fork 标记 `isSummarizer`；这三处对 summarizer child **改写为内部 harvest**——写一条**内部 context-change marker**（唤醒 parent 但渲成 `[context_change:context_compressed]` 而非 peer 消息）+ 记 `win.summarizedRanges` + 清 `win.inFlightCompress`，**不进 LLM 会话**、不双记。

### C3（CRITICAL，修）—— 保留 clamp 作 floor
clamp（`transcript-clamp.ts`）本就**无损**（per-round 瞬态、不改 events、不持久化）；它是唯一**同步保底**。force-wait 是异步+条件性（依赖 fork 完成）。**修**：**不删 clamp**——force-wait + fork-summarize 是**优雅路径**，clamp 是其**下方的最后兜底**（fork 失败/超时/seed 过大时仍保不崩）。clamp 仅在 force-wait 未能把 context 压到 hard 下时触发。删 clamp 推迟到 force-wait 生产实证后再单独决策。

### H1（HIGH，修）—— 独立阈值字段，不复用 compressLevel
`ThreadWin`（`types.ts:34-37`）**无 compressLevel**；且 renderer（`xml.ts:349`）对所有窗 content 无条件 `projectByCompressLevel(compressLevel)` → 复用作阈值会引发展示折叠副作用。**修**：阈值用**独立字段** `win.autoCompressLevel`（thread 窗专用）；resize 在 thread 窗设它、在内容窗设 compressLevel（display）。不耦合 renderer 的 display 读路径。

### H2（HIGH，修）—— spawn+mark 原子
auto-trigger hook 须把 spawn fork + 置 `win.inFlightCompress` 作**单次写回**（写在 `buildInputItems:436` 读的同一 `selfThreadWin` 实例上、本轮返回前 persist），防双 spawn 双记（`normalizeSummarizedRanges` 会 concat 摘要）。

### H3（HIGH，修）—— force-wait 按 transcript 而非 windows
force-wait/触发只在 **transcript 是超 hard 主因**时（`transcriptTokens > 阈值`），不用 `currentTokens(windows+transcript) > hard`——否则 windows 主导超限时 fork 压 transcript 无效 → livelock。windows 超限由 `BudgetManager.allocate` overflow 处理（与 compress 正交）。auto-trigger 与 force-wait **共用同一 transcript 估算**。

### M1（MEDIUM，修）—— 删默认表前迁内容窗
删 `default-window-methods.ts` + `resolveWindowMethod` 默认回退会让 **file 等内容窗失去 compress/expand**（display 折叠，`xml.ts:349` 在用）。**修**：内容窗（file 等）的 display 折叠改由其 class 自声明 `resize`（设 compressLevel），迁移完成后再删默认表；或默认表先保留只服务内容窗 display、仅去掉 events/scope。删默认表前 grep 审计所有 `resolveDefaultWindowMethod` 消费者。

### M3（SCOPE，采纳）—— 不一次自主全落 + 耦合/回归约束
- 审查判定：动核心 thinkloop+scheduler + 新 summarizer 子系统 + 删 floor + renderer 字段重载 + 需真 LLM 多线程调度验证 → **不宜一次自主盲落**。
- **关键耦合/回归约束**：协议改动（compress/expand→resize/compress + 删 compress-events/scope）若**单独**落而不带 fork-summarizer，会**回归 Case A 已工作的 events-compress**（compress 变 inert intent、agent 暂时折不了 events）。故协议改动与 fork-summarizer **必须同一可验证单元一起落**，不能拆「安全 Stage 1」单独落。
- 因此本设计的**实现是一个耦合的大单元**（协议 + summarizer-fork + auto + force-wait + 保留 clamp），需真 LLM 多线程验证 + 人工 checkpoint，**不在用户离开期间盲落**——避免破坏核心 loop 或回归 Case A。

### 修订后的实现单元（一起落、勿拆）
1. `ThreadWin` 加 `autoCompressLevel?` / `compressIntent?` / `inFlightCompress?`。
2. thread readable 声明 `resize`（设 autoCompressLevel/compressLevel）+ `compress`（置 compressIntent）；内容窗 display 折叠迁 class 自声明 resize（M1）。
3. `spawnSummarizerFork`（复用 execFork programmatic；seed 早期 transcript；标 isSummarizer + parent.win.inFlightCompress 原子）。
4. harvest（`emitChildEndNotifications` 邻接：summarizer done → 内部 marker 唤醒 + 记 summarizedRanges + 清 inFlightCompress；suppress 三处 child-end 污染）。
5. auto-trigger hook（thinkloop，transcript 阈值/intent → spawn，H2 原子、H3 transcript-gated）。
6. force-wait（thinkloop 入口，transcript 超 hard + in-flight → waiting；**保留 clamp 作其下 floor**）。orphan/stuck-fork 超时清 inFlightCompress（+ clamp 兜底）。
7. 删 compress-events/scope；**保留** clamp + summarizedRanges 载体 + budget 估算。
8. 测试（含真 LLM 端到端 + 跨 job reload）+ 退潮 + 文档 + push ooc-0。
