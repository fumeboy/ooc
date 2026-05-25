# Agent-loop Visualizer 实施计划（P1-3 Round 3）

**作者**：Supervisor（Claude Code 主会话）
**日期**：2026-05-25
**性质**：plan（不是 design — 是分阶段实施路线图）
**前置阅读**：
- `docs/2026-05-25-ccb-observation.md` § 缺口判断 + Round 1/2 闭环（context_compressed / permission_* 等 ProcessEvent 已就位）
- `meta/object.doc.ts:observable`（LlmObservation / debug_files / context_snapshot 的现状）
- `meta/object.doc.ts:visible.children`（stone_client / flow_client_pages / agent-native UI 等价路径未落地）
- `meta/app.client.doc.ts`（chat / ThreadHeader / ContextSnapshotViewer / LLMInputJsonViewer 现状）

---

## 1. 背景：为什么是"加 visualizer"而非"建可视化基础设施"

经 Round 1 + Round 2，OOC 的"agent 一轮在做什么"已经在数据层完全 traceable：

| 数据 | 始终落盘 | 内容 |
|---|---|---|
| `thread.events: ProcessEvent[]` | ✅ | text / reasoning / tool_use / tool_result / context_compressed / events_summary / permission_ask / permission_denied / context_change |
| `<threadDir>/llm.input.json` | ✅（writeLatestLlmInput）| 最近一次 inputItems + contextSnapshot |
| `<threadDir>/llm.output.json` | ✅ | 最近一次 normalized outputItems |
| `<threadDir>/debug/loop_NNNN.{input,output,meta}.json` | ⚠️ 仅 enableDebug() 后 | 每轮 4 位 0 padding 文件，含 latency / messageCount / toolCount / contextBytes |
| `ContextSnapshot` | ✅（与 system XML 同源）| 当前 thread 状态结构化快照 |

并且前端已有部分 viewer：

| 组件 | 路径 | 能力 |
|---|---|---|
| `LLMInputJsonViewer` | `web/src/domains/files/components/LLMInputJsonViewer.tsx` | 单文件视图 inputItems + 嵌入 ContextSnapshotViewer |
| `ContextSnapshotViewer` | 同目录 | 左树 + 右详情看 ContextSnapshot |
| `FileViewer` | 同目录 | 通用文件预览（任意 path）|
| `ThreadHeader` | `web/src/domains/sessions/components/` | session 内 thread 切换 |

**缺什么**：把上述数据**按 loop 维度聚合**的时间轴视图——一个 thread 跑了 N 轮 thinkloop，每一轮发生了什么、用了多久、调了什么 tool、是否压缩 / 拒绝 / 暂停。

**结论**：P1-3 不是从零造，而是"组件聚合 + 后端轻量 API 增量 + 高亮交互"。

---

## 2. 目标 / 非目标

### 目标（本轮做）
1. 给 thread 详情页加一个 **Loop Timeline 视图**（与现有 Transcript / ContextSnapshot 并列的 tab）
2. 时间轴按 `loopIndex` 排序展示每一轮 thinkloop
3. 每个 loop entry 含：loopIndex / startedAt / latencyMs / messageCount / toolCount / 关键 event 概览（含图标）
4. 展开任一 loop：嵌入 `LLMInputJsonViewer`（input.json）+ output.json + meta.json
5. **关键 event 高亮**：context_compressed / events_summary / permission_ask / permission_denied / function_call_output 失败 → 时间轴 chip + 颜色编码
6. **退化模式**：debug 未启用时仅显示 thread.events 派生的简化时间轴（无 loop boundary，但能看 event sequence）

### 非目标（本轮不做）
- 跨 thread / 跨 session 聚合视图（先做单 thread）
- 性能/cost 指标聚合（CCB Langfuse 风格——远景）
- 远程 trace 上报（如真上 Langfuse / OTLP——远景）
- 后台 collector（数据已在文件系统，无需采集）
- agent-native UI 等价路径完整落地（Agent 通过 server method 看自己 loop timeline）——本轮先做 UI 侧

---

## 3. 设计原则

### A. 派生而非采集
所有 timeline 数据都从**已有持久化文件**派生（`thread.json` + `debug/loop_NNNN.*.json`）。不引入新的存储或采集进程。这与 OOC `observable` 哲学一致——"所有状态都进 ProcessEvent 流或文件系统"。

### B. type-dispatch 风格的 event 渲染
关键 ProcessEvent 的图标 / 颜色由"事件 type + kind"分发，与 `WindowTypeDefinition.renderXml` / `compressView` 同协议。新增 event 类型时只加新 entry，不改 timeline 主框架。

### C. visibility-first
- debug 未启用也要看见东西（退化模式）
- 关键事件（permission_ask 等）不能藏在"展开看详情"才出现，必须在 timeline 主线一眼可见
- silent-swallow ban 适用——任何"我们故意不显示的事件"必须有明确 hint（如 events_summary 折叠的 N 条事件应显示为 1 个折叠节点而非完全消失）

### D. agent-native 等价路径预留
本轮做 UI；但后端 API 形状要让"Agent 通过 server method 调用 list-loops"的等价路径自然可加（不要为前端硬编码 query string 之类的 UI 私有契约）。

### E. 不破坏现有 viewer
LLMInputJsonViewer / ContextSnapshotViewer 保持原貌，只是 Loop Timeline 在自己的视图里**嵌入**它们。

---

## 4. 数据来源映射

| Timeline 字段 | 来源 | enableDebug 关闭时退化 |
|---|---|---|
| loopIndex | `debug/loop_NNNN.meta.json` | 不可知 → 用 event index |
| startedAt / latencyMs | meta.json | 不可知 → 不显示 |
| messageCount / toolCount | meta.json | 从 events 推算 tool_use 数 |
| contextBytes | meta.json | 不可知 |
| status (success/error/paused) | meta.json | 从 events 末尾的 tool_result.ok 推断 |
| input items 摘要 | input.json | 从 thread.events 派生 |
| output items 摘要 | output.json | 从 thread.events 派生 |
| 关键 event 列表 (compressed/permission/...) | thread.events 过滤 | 同左 |

---

## 5. 后端 API 增量（最小）

### 5.1 新增：列出所有 loop debug
```
GET /api/runtime/flows/:sessionId/objects/:objectId/threads/:threadId/debug/loops
```
返回：
```ts
{ loops: Array<{ loopIndex: number, hasInput: boolean, hasOutput: boolean, hasMeta: boolean, meta?: LoopMeta }> }
```
- 实现：扫 `<threadDir>/debug/` 下 `loop_NNNN.meta.json` 文件，按 loopIndex 升序返回
- 不携带 input/output 全文（仅元信息）；前端按需 GET 单条
- debug 未启用 / 目录不存在 → 返回 `{ loops: [] }`，不抛错
- 复用 `RuntimeService` 现有 baseDir 路径解析

### 5.2 复用现有：
- `GET .../debug` — 最新一次 latest（不动）
- `GET .../debug/loops/:loopIndex` — 单 loop 全量（不动）
- `GET .../threads/:threadId` — thread.json 完整（不动；含 events）

**API 增量到此为止；其余全是前端渲染**。

---

## 6. 前端组件分解

### 6.1 新增组件

```
web/src/domains/sessions/components/
├── LoopTimeline.tsx              ← 主组件；按 loopIndex 排开
├── LoopEntry.tsx                  ← 单 loop 行；含 chips 与展开
├── LoopEventBadge.tsx             ← context_compressed / permission_* 等图标 + 颜色
└── LoopTimeline.test.ts           ← 单测
```

### 6.2 复用组件

| 现有组件 | 怎么用 |
|---|---|
| `LLMInputJsonViewer` | LoopEntry 展开时，对 loop_NNNN.input.json 直接 render |
| `ContextSnapshotViewer` | 嵌套在 LLMInputJsonViewer 内（已是它的子组件）|
| `JsonTreeView` | output.json / meta.json 的展示 |

### 6.3 接入位置

ThreadHeader 已经有 thread 切换器；新加一个 tab/section：

```
[Transcript] [Loop Timeline (P1-3)] [Context Snapshot] [Debug Files]
```

具体接入点找 `web/src/domains/sessions/` 下的 thread page 主组件（实施时定位）。

### 6.4 LoopEventBadge 的 type-dispatch 表（草案）

| event | icon | color | 单击行为 |
|---|---|---|---|
| `context_compressed` (reason=user-compress) | 🗜️ | blue | 跳到对应 event 详情 |
| `context_compressed` (reason=idle-fold/age-fold/...) | 🍂 | gray | 同上 |
| `context_compressed` (reason=emergency-guard-*) | ⚠️ | orange | 同上 |
| `events_summary` | 📚 | purple | 展示 summary 文本 |
| `permission_ask` (pending) | ⏸️ | yellow | 跳到 approve/reject 入口 |
| `permission_ask` (approved) | ✅ | green | 显示 decided.reason |
| `permission_ask` (rejected) | ❌ | red | 同上 |
| `permission_denied` | 🚫 | red | 显示 reason |
| `tool_result` (ok=false) | ⚠️ | orange | 跳到 function_call_output 详情 |
| `tool_use` (`compress`, `wait`, `close`) | 🛠️ | default | 跳到 args |

emoji 仅占位；最终用 SVG 图标库（与现有 web 风格一致）。

---

## 7. 分阶段实施

| Phase | 工作量 | 范围 | 验收 |
|---|---|---|---|
| **R0a** | 小 | meta design：`observable.children` 加 `loop_timeline` 子节点 + `visible.children.flow_client_pages` 加 patch | Supervisor 直写 + tsc clean |
| **R0b** | 小-中 | 后端 API 5.1：list-loops endpoint + service 方法 + 单测 | API 单测 PASS：3 用例（debug 关闭返回空 / loop 存在按序返回 / 路径不存在 fallback）|
| **R0c** | 中 | 前端 LoopTimeline + LoopEntry + LoopEventBadge + 接入 thread 页 + 单测 | 单测 PASS（fixture 数据驱动）；冒烟 dev server 看视觉 |
| **R0d** | 中 | 退化模式（debug 关闭）+ 关键 event 高亮 + 跳转交互 | 单测覆盖退化路径；Playwright 冒烟（不强制）|

R0a~R0b 是后端铺垫；R0c 是 UI 主干；R0d 是体验闭环。

**关键依赖**：R0c 依赖 R0b 完成（前端要 list-loops API）；R0a 独立。R0a + R0b 可并行；R0c 串行。

---

## 8. 派单规划

按 Round 1/2 模式，5 个 sub agent：

1. **R0a → Supervisor 直写**（meta 修改 + design 落点）
2. **R0b → AgentOfObservable**（HTTP API + service 方法）
3. **R0c → AgentOfVisible**（前端主组件）
4. **R0d → AgentOfVisible**（退化模式 + 高亮，可与 R0c 同一 sub agent 续做或拆）

R0b 与 R0c **不能并行**——R0c 需要先 hit 真 API。

---

## 9. 不变量

- **数据来源不分裂**：所有 timeline 数据都从 `thread.json` + `debug/loop_NNNN.*.json` 派生；不在前端 / 后端引入额外 cache 或快照
- **后端 API 单一职责**：list-loops 只列 meta；不在一个请求里把全部 input/output 塞回
- **type-dispatch**：新增 event 类型时只加 LoopEventBadge entry，不动 timeline 主框架
- **退化优雅**：debug 未启用时不报错，仍能展示 events 流时间序列
- **agent-native 预留**：API 路径与现有 RuntimeService 模式一致；server method 等价路径可在 Q0e 或后续 phase 落地

---

## 10. 风险

| 风险 | 概率 | 缓解 |
|---|---|---|
| 长 thread 加载 N 个 loop_NNNN.meta.json 慢 | 中 | list-loops 只读 meta（每个 ~200 字节）；前端 lazy load input/output；R0d 可加分页（loopIndex 范围） |
| 视觉风格不和现有 web 主题统一 | 高 | 复用 web/src/styles.css 中现有 token；R0c sub agent prompt 强调"先读现有 viewer 的视觉风格" |
| 关键 event 太多导致 timeline 噪音 | 中 | LoopEventBadge 仅 surfacing 主线事件（compressed / permission / tool error）；常规 text/tool_use 不进 badge |
| enableDebug 切换状态用户不知道，看不到 loop 详情却以为是 bug | 中 | timeline 顶部显示 debug 开关状态 + 一键启用按钮（复用现有 MainLogo 的 debug 切换路径） |
| Playwright 测试 flaky | 中 | R0d 不强制 Playwright；单测优先；冒烟用 dev server 视觉 |

---

## 11. 不照搬 CCB 的部分

| CCB Langfuse 集成 | OOC 等价 |
|---|---|
| 远程 trace 上报 | 本地文件派生（不上报）|
| Token / Cost 聚合 | 只显示 meta.json 已有字段；不引入 cost 模型 |
| Auto-trace SDK 插入 | 不需要——OOC ProcessEvent 流已经是 trace |
| Dashboard 多 thread 比对 | 本轮单 thread；多 thread 聚合留远景 |

---

## 12. 与上轮（P0-1 / P0-2）的接口

- **接 P0-2 (context budget)**：context_compressed / events_summary 已是 ProcessEvent，timeline 自动展示
- **接 P0-1 (permission)**：permission_ask / permission_denied 已是 ProcessEvent，加上 approve/reject HTTP 入口可在 timeline pending ask 旁直接点 approve；R0d 可考虑实现这个"在 timeline 内直接审批"的快捷路径
- **不动**：thinkable.context_budget / executable.permission 概念不变；仅 visible/observable 维度扩展

---

## 13. 验收指标

最终交付要满足：
1. 任一 thread 进入页面 → 看到 Loop Timeline tab → 点击展开看到时间轴
2. 时间轴每个 loop entry 显示 loopIndex / latency / 关键 event chips
3. 单击 loop entry 展开 → 嵌入 LLMInputJsonViewer 看 input + ContextSnapshot
4. 关键 event 高亮：compressed / permission_ask（含三态）/ permission_denied 各有不同视觉
5. debug 关闭的 thread：仍看到 events 流时间序列（退化模式），顶部提示"启用 debug 看完整"
6. 不破坏现有 ChatPanel / ThreadHeader / ContextSnapshotViewer 任一交互
7. 单测：LoopTimeline / LoopEntry / LoopEventBadge / list-loops API 各覆盖

---

## 14. 下一步（待 Supervisor / 用户拍板）

1. **plan 接受？**（是 → 进入 R0a；否 → 哪条原则需调）
2. **R0a meta 落点选择**：
   - 选 A：`observable.children.loop_timeline` 新节点
   - 选 B：`visible.children.loop_timeline` 新节点
   - 选 C：横切 patch（observable + visible）
   倾向选 B（UI 是 visible 维度，数据派生靠 observable 已有概念）

---

## 历史

- **2026-05-25**：首版。Round 3 P1-3 plan。
