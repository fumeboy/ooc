# Issue: events compress —— thread 对话历史的摘要折叠（参考 Claude Code compaction）

> 来源：兑现 windows compress（`docs/2026-06-20-compress-window-method-revival.md`）时裁决拆出的 scope=events 部分。
> 性质：类型脚手架已铺满、读出侧已接通、**写入侧空**。归 thread builtin object 自身能力。
> 状态：设计 Issue，含一处派发冲突待实现时拍板。

## 1. 背景与边界

windows compress（已落地）是**纯 window method**：改单窗 `win.compressLevel`、零副作用、renderer 按档位投影详略。
events compress 是另一回事：**折叠 thread 自己的对话历史**——改 `thread.events`（thread object 的 data），有副作用，**不是** window method 能做的（window method 契约纯函数）。故归 thread builtin object 的能力，单独立项。

两者共享同一哲学根（supervisor-7：**compress 是视角投影，不是销毁**），但作用对象不同：一个折单窗展示详略、一个折对话历史长度。

## 2. 现状脚手架（已核验，`thread.ts`）

类型层完整，写入侧无人填、读出侧已通：

- **`events_summary` event**（`thread.ts:307`）：`count`（被折数量）/ `earliestEventId` / `latestEventId`（折叠区段边界）/ `summary`（摘要正文，LLM 提供）/ `qualityHint: "rough" | "curated"`（agent 精选 vs auto 占位）/ `scope: "user" | "auto"`。
- **`_foldedBy`**（`thread.ts:139`，注释 131）：被折 event 标记 `_foldedBy=summaryId`，**渲染跳过、实际数据仍在**（→ 可逆）。
- **稳定 `id`**（注释 128-129）：events_summary 可被 `_foldedBy` 引用；其他 event 可选携带 id，供 `compress(scope=events, target_event_ids)` 点名折叠。
- **`context_compressed` event**（`thread.ts:270`）：档位/折叠切换的 observability 记录，`scope` 含 `"events"`。
- **读出侧已就绪**：`context/index.ts:380-383` `event._foldedBy ? [] : processEventToItems(...)` 跳过被折 events；`processEventToItems` 把 `events_summary` 渲成一条 system message 占位（含 count + summary）。

**缺的只是写入侧**：没有任何代码 push `events_summary` / 设 `_foldedBy`。

## 3. 设计：参考 Claude Code，但对象化模型给出不同答案

| 决策点 | Claude Code | OOC events compress（本设计） |
|---|---|---|
| **触发** | 水位自动（auto-compact）为主 | **agent 主动（user scope）为主**——上下文工程是 agent 自己的能力；`auto`（emergency_guard 逼近 hard 水位）兜底为辅。对应已有 `scope` 字段。`budget.ts` 现有 overflow 软呈现不变。 |
| **谁摘要** | runtime 另起一次 summarization LLM call | **agent 自己写**——在 thinkloop 里把 `summary` 作为 `compress(scope=events)` 的 args 传入，省一次独立 call、更连贯（agent 本就理解上下文）。`qualityHint=curated`。auto 兜底先机械折叠成 `rough` 占位。 |
| **摘要形态** | 结构化重模板（任务/文件/决策/下一步…） | **纯文本 `summary` 足够**。关键差异：OOC 的状态活在 **object 自身**（data / self.md / 成员窗 / pool），events 只是「过程」。Claude Code 状态全在对话里、必须靠模板抢救；OOC 不靠摘要兜状态 → 摘要更轻、**风险更低**（细节丢了，看对象窗即恢复状态认知）。 |
| **保留策略** | 折早期、保最近若干轮全文；microcompact 选择性清旧 tool 结果 | 默认 `keepTail`（保尾部 N 条）+ `target_event_ids` **点名折叠**（既可整段折早期，也可精准清掉某几条噪声 tool 结果，覆盖 microcompact 用例）。 |
| **可逆性** | 摘要替换原文、当前窗内不可逆 | **可逆**——`_foldedBy` 是标记非删除，events 仍在 flow 盘上。`expand(scope=events)` 清 `_foldedBy` + 删 summary 节点即还原。与 windows 档位升降同构。 |

## 4. 派发冲突 —— 实现时须拍板（两方案并陈）

原设计想用**同一个 `compress` + `scope` 参数**分流 windows / events（`thread.ts:277`）。但 `exec.ts:110` 派发顺序是 **先 object method、后 window method**：
- windows compress = 纯 **window method**（已实现，挂默认表）
- events 折叠 = 改 `thread.events` 的 **object method**（有副作用）

若 events 折叠注册成 thread 的 `compress` **object method**，则 thread 窗上 `exec(compress)` 永远被 object method 截获，thread 窗再用不了 windows 投影 —— **同名撞车**。

- **方案 A（拆名）**：events 折叠用独立 method 名（`fold_history` / `summarize_history`），`compress/expand` 专指窗投影。语义清晰、零派发冲突；代价是丢了「一个 compress 管两种」的统一。
- **方案 B（thread 专属 compress 内部按 scope 分流）**：thread builtin override `compress` object method —— `scope=events` 折历史；`scope=windows` 时由该 object method 改自己的 `win.compressLevel`（object method 经 ctx 也可写投影态）。其它窗仍走默认 window method。保住统一语义，代价是 thread 承担一点 method 复杂度。

倾向 B（保统一语义），但留实现时定。

## 5. 落地归属 / 范围 / 验收

**归属**：thread builtin object 的能力（改 thread 自己的 events data，符合「实例独占状态归该 object」，见 persistable 框架/builtin 边界）。不是通用默认 window method 表。

**本次范围（user scope 主路径）**：
- 写入侧：thread 的 method（名字按 §4 拍板）—— 接收 `summary` + 可选 `target_event_ids`，缺省按 `keepTail` 折早期；给被折 events 标 `_foldedBy`、push `events_summary{count, earliestEventId, latestEventId, summary, qualityHint:"curated", scope:"user"}`。
- 反向 `expand(scope=events)`：清 `_foldedBy` + 删对应 events_summary 节点。
- 复用既有 `events_summary` / `_foldedBy` / `id`，**不新增 event kind / 字段**。
- 读出侧已就绪，**不改 renderer**（仅核验折叠后 XML 中被折 events 由 summary 占位替代）。

**验收**：
- thread 上 exec(折叠 method, {summary, target_event_ids?}) → 被折 events 标 `_foldedBy`、push 一条 `events_summary`；渲染时被折段由 summary 占位替代、整体 events transcript 变短。
- expand 可逆：还原后被折 events 重新渲出。
- 至少一条 storybook 控制面断言（构造带多 events 的 thread → 折叠 → 断言渲染 item 数下降 + summary 出现 + expand 还原），登记进 thinkable/persistable `knowledge/tests.md`。
- `bun run verify` 全绿。

## 6. 后续（不在本 Issue）

- **auto / emergency_guard 兜底**（scope="auto"）：逼近 budget hard 水位时自动机械折叠成 `rough` 占位 —— 第二阶段。
- **context_compressed event 落账**：events fold 时同步写一条 observability 记录（与 windows compress 的 event 落账一并做，runtime 层）。
- **auto 场景的高质量摘要**：若要 auto 也产 curated 摘要，需 runtime 编排一次 summarization call（接近 Claude Code 原味）—— 评估必要性后再定。

## 7. 派单纪律

- 不要自己 commit（交回 Supervisor 整合）。
- 中间态打破存量测试只登记账本、不逐条修；改完统一跑绿。
- 自验证 session 用 `_test_evcompress_<timestamp>` 前缀，验完清理。
- 复用既有类型，新增名词前先问能否复用（克制熵增）。
