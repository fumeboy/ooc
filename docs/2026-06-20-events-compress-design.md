# Issue: events compress —— thread 对话历史的视角内折叠（window method）

> 来源：兑现 windows compress（`docs/2026-06-20-compress-window-method-revival.md`）时拆出的 scope=events 部分。
> 关键修正（2026-06-20，用户拍板）：events 折叠**保持 window method 行为**，折叠态存 `win`（视角独立投影态），
> **不**改 `thread.events`（object data）。原"object method 改 thread.events"方向作废，派发冲突随之消解。

## 1. 核心洞察 —— 折叠是视角投影，不是数据变更

thread 有**两种视角**（supervisor-7：context 是视角非归属）：
- **self 视角**：agent 看自己的 thread，events 平铺成 message 流（`context/index.ts:381` `thread.events.flatMap`）。
- **peer 视角**：creator 看 callee 的 thread，thread 作为一个**窗**，transcript 在窗内容里。

A 视角折叠历史**不该**影响 B 视角。所以折叠态必须**视角独立**——存在每视角各自的 `win`（像 windows compress 的 `compressLevel`），而非跨视角共享的 `thread.events` data。

OOC 现状恰好支撑这点：thread 两端各存一份**内联实例**（supervisor-7 审计曾把"内联非指针表"判为 drift——在这个场景里反成 feature：`win` 天然视角独立）。

**结论**：events 折叠 = **window method**（纯函数改 win），不是 object method。

## 2. 方案：win 持折叠坐标，渲染时按坐标投影

**win 投影态新增**（与 `compressLevel` 同属 `inst.win`，视角独立、可持久化）：

```
win.summarizedRanges?: Array<{ fromIdx: number; toIdx: number; summary: string }>
```

- `fromIdx`/`toIdx`：被折叠区段在 `thread.events` 的**数组 index 坐标**（events 是 append-only，已发生 event 的 index 稳定）。
- `summary`：该区段的摘要文本（agent 提供）。

**window method（纯函数，返回新 win）**：
- 折叠：往 `summarizedRanges` 加一段 `{fromIdx, toIdx, summary}`，返回新 win。视角独立——只改这个视角的 win。
- 展开：从 `summarizedRanges` 移除对应段，返回新 win。可逆。

**渲染（读出侧投影）**：
- self 视角 `context/index.ts:381` transcript 构造：按 thread 自身投影态 win 的 `summarizedRanges` 投影——落在某 range 内的 events，区段首位渲一条 summary 占位、其余跳过；range 外正常渲。
- peer 视角：thread 窗内容渲染同理按该窗 win 的 `summarizedRanges` 投影。
- **实现要点**：当前 `index.ts:381` transcript 构造**不读任何 win**，需接线让它拿到 thread 自身投影态的 `win`（self 视角的折叠态承载点，实现时定位）。

## 3. 派发冲突已消解（删原 A/B 两方案）

原 Issue 担心：events 折叠若是 object method，`exec.ts:110` 先 object 后 window，会截获 thread 窗的 windows 投影。
**翻转后不存在**：events 折叠与 windows compress **都是 window method**，同走 window method 派发路径。可由同一个 `compress` method 按 `args.scope` 内部分流：
- `scope=windows` → 改 `win.compressLevel`（已实现）
- `scope=events` → 改 `win.summarizedRanges`（本 Issue）

一个 method、两种 scope、统一语义，零派发冲突。

## 4. 参考 Claude Code compaction —— 对象化模型给出的不同答案

| 决策点 | Claude Code | OOC events compress |
|---|---|---|
| 触发 | 水位自动为主 | **agent 主动（user）为主** + auto 兜底为辅（上下文工程是 agent 自己的能力） |
| 谁摘要 | runtime 另起 summarization call | **agent 自己写**，summary 作 method args 传入（省一次 call、更连贯） |
| 摘要形态 | 结构化重模板（任务/文件/决策…） | **纯文本 summary 足够**——OOC 关键状态活在 object（data/self.md/成员窗），events 只是过程；细节丢了看对象窗即恢复，**风险更低** |
| 保留策略 | 折早期、保最近全文；microcompact 清旧 tool 结果 | `keepTail` 默认 + 显式 `{fromIdx,toIdx}` **点名折叠**（精准清噪声 tool 结果，覆盖 microcompact 用例） |
| 可逆 | 摘要替换原文、当前窗内不可逆 | **可逆**——折叠态在 win 投影态、`thread.events` 一字不改；展开即还原 |

最深的差异：Claude Code 状态全在对话里、必须靠结构化摘要抢救；OOC 状态在对象里，events compress 只是**视角怎么看历史**，丢摘要细节不丢状态。

## 5. 对现有 `_foldedBy` / `events_summary` 脚手架的处置

现有脚手架（`thread.ts:139,307` + `index.ts:166,381`）把折叠态放进 **thread.events（object data，跨视角共享）**——与"视角独立折叠"前提矛盾。user 主路径**不用它**，改用 `win.summarizedRanges`。

**去留 = auto 兜底是否需要"跨视角、落盘、永久"的折叠**（待 auto 阶段裁决）：
- 若 auto emergency 折叠应对所有视角生效且持久 → `events_summary`/`_foldedBy` 可保留专供 auto（`scope="auto"`）。
- 若 auto 也走 win 投影态（runtime 给每视角 win 加段）→ 现有脚手架整体退役（涨潮必退潮，避免两套折叠机制熵增）。

本 Issue 不武断删；标记其"方向存疑、user 路径不依赖"，待 auto 阶段统一裁决。

## 6. 落地范围 / 验收

**归属**：events 折叠是 window method（改 win），可挂通用默认表（与 compress/expand 同源，scope 分流）或 thread 投影窗声明——实现时择优。**改 thread 自身投影态的 win，不改 thread.events data。**

**本次范围（user scope 主路径）**：
- win 类型加 `summarizedRanges`；window method `compress(scope=events, {fromIdx,toIdx,summary})` + `expand(scope=events)` 纯函数增删段。
- 读出侧投影：`index.ts:381` self transcript 构造 + peer 窗渲染按 `summarizedRanges` 投影；接线让 transcript 拿到视角独立 win。
- 不改 `thread.events`；不依赖 `_foldedBy`/`events_summary`。

**验收**：
- thread self transcript：折叠某 range → 该段 events 由一条 summary 占位替代、transcript item 数下降；range 外原样。
- 视角独立：peer 视角不受 self 折叠影响（构造两视角断言互不污染）。
- 可逆：expand 还原被折段。
- storybook 控制面断言（构造多 events thread → 折叠 → 断 item 数降 + summary 出现 + 视角隔离 + expand 还原），登记 thinkable `knowledge/tests.md`。
- `bun run verify` 全绿。

## 7. 后续（不在本 Issue）

- **auto / emergency_guard 兜底**（逼近 budget hard 水位自动折叠）+ 据此裁决 `_foldedBy`/`events_summary` 去留。
- **context_compressed event 落账**（observability，与 windows compress 的 event 落账一并做）。

## 8. 派单纪律

- 不要自己 commit（交回 Supervisor 整合）。
- 中间态打破存量测试只登记账本、不逐条修；改完统一跑绿。
- 自验证 session 用 `_test_evcompress_<timestamp>` 前缀，验完清理。
- 复用既有类型，新增名词前先问能否复用（克制熵增）。

## 9. 落地结果（2026-06-20，Supervisor 整合）

实现前对 §1/§5 前提做了代码核验，用户 grilling 修正了两处认知，结论：**win.summarizedRanges
方案对两视角都对（用户拍板成立）**，但原 §1/§5 的论证依据被证伪、需更正：

1. **两视角读的不是同一份 events（§1 论证更正）**：self 视角 transcript = `thread.events`
   （`thinkable/context/index.ts` buildInputItems），peer 视角 transcript = `filterTalkMessages`
   只读 `thread.inbox`/`outbox` messages（`builtins/agent/children/thread/readable/talk-render.ts`
   filterTalkMessages + `conversation-render.ts`）——**peer 视角根本看不到 `thread.events`**。
   故折叠 `thread.events` 天生只影响 self 视角，"跨视角污染"不存在；§5 把 events_summary 判为
   "跨视角共享"是基于"两视角共享 events"的误读。**但 peer 视角有自己的 transcript（messages）
   要折**——win.summarizedRanges 正好通用服务它（用户拍板的核心洞察成立）。

2. **win 确有持久化的家（§2"可持久化"成立）**：`THREAD_CLASS_ID` 是 `mode:"inline"`
   （`builtins/agent/children/thread/persistable/index.ts`），inline 窗整窗（含 win）落
   thread-context.json（`thread-persist.ts` buildEntries → hydrate `win: env.win`）。`win.transient`
   只管 `saveObjectData`（要不要单独 state.json），不影响 inline 窗的 win 持久化。故会话窗
   （talk/creator/peer）的 summarizedRanges 跨 reload 存活。**唯一例外是 self 门面窗**
   （`isSelfWindow`，`buildEntries` 默认跳过）——为此补：self 窗带 summarizedRanges 时整窗
   inline 落盘（data 确定性={}，无死 _ref；init 幂等守卫 reload 后保留）。

### 实现（统一存储 + 通用投影，零第二机制）
- `_shared/utils/summarized-ranges.ts`：`SummarizedRange` 类型 + 纯增删 helper（写入侧不夹边）+
  通用 `projectSummarizedRanges(items, ranges, renderItem, renderSummary)`（段内连续 items 折成一条 summary）。
- `readable/default-window-methods.ts`：`compress`/`expand` 按 `args.scope` 分流——`windows`（默认）
  改 `compressLevel`（既有）；`events` 改 `summarizedRanges`（`keepTail=N` 保留末 N 条 / `fromIdx,toIdx`
  点名区段，`summary` agent 自写）。加 schema 供菜单发现。
- 读出侧：self 视角 `context/index.ts` 按 self 窗 summarizedRanges 折 `thread.events`；peer 视角
  `conversation-render.ts` 按会话窗 summarizedRanges 折 messages（与 viewport 干净组合）。
- 持久化：`thread-persist.ts` self 窗带 summarizedRanges 时整窗 inline 落盘。
- 测试：storybook `L2-COMPRESS-EVENTS`（Tier A 控制面）+ `thinkable/__tests__/context.test.ts`
  （buildInputItems 端到端 self 折叠）+ `thinkable/__tests__/real-compress.test.ts`
  （真 LLM 自主 compress，gate `RUN_REAL_COMPRESS_TEST=1`，已实证：keepTail=2 折早期 5 轮为一条摘要）。

### §5 脚手架处置（更新）
旧 `_foldedBy`/`events_summary`（thread.events object data）**user 路径不再依赖**——self 折叠走
win.summarizedRanges。读出侧 `context/index.ts` 仍保留 `_foldedBy` 跳过为休眠兜底（renderItem 内），
`events_summary` event kind 渲染保留——**专留 auto/emergency 阶段裁决**（§7），无写入侧故当前 dormant。

### 后续（仍不在本 Issue）
- auto / emergency_guard 兜底（逼近 budget hard 自动折叠）+ 据此裁决 `_foldedBy`/`events_summary` 去留。
- `context_compressed` event 落账（observability）。
- peer 视角 keepTail 便捷模式（当前 keepTail 取 `ctx.thread.events.length`，对 self transcript 精确；
  talk 窗用显式 fromIdx/toIdx，读出侧按真实 messages.length clamp 兜底）。
