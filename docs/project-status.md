# OOC 项目状态

> **何时读这份**：想知道 OOC 系统目前"能干什么 / 不能干什么 / 下一步往哪推"，又
> 不想读完整个 `meta/iteration.doc.js` 历史时。这份每次重要节点（阶段收尾 / 大规模
> 修复 / 测试套件状态变化）后更新；更细的迭代历史在 `meta/iteration.doc.js`。
>
> 最后更新：**2026-05-17**

---

## 一句话定位

OOC 是个能跑通"真 LLM + 真文件 + 真协作 + 真持久化"端到端 CodeAgent 闭环的系统。
当前阶段已经超越基础设施稳定性，主要任务是性能 / 可观察性增强 + 真实使用场景扩展。

---

## 当前能力

### 1. 核心抽象（阶段 9 完成）

- **ContextWindow 统一模型**：9 种 type（root / command_exec / do / todo / talk /
  program / file / knowledge / search），全部走相同的 open/refine/submit/close
  生命周期；取代了早期"form / window / pinnedKnowledge / inbox-outbox"四套并列概念
- **5 原语**：`open` / `refine` / `submit` / `close` / `wait` / `compress`。`wait`
  在 spec 2026-05-17 后强 referent 化（`wait(on=<window_id>)` 必填），不再是无依据兜底
- **多线程 + scheduler**：thread 树、公平调度、inbox 增长唤醒、waiting/done 状态机
- **knowledge 三种来源**：protocol（每轮自动）/ activator（命令路径命中）/ explicit
  （LLM `open_knowledge` pin）。activator 同时看 `command_exec.commandPaths` 与
  `program_window` 最近 exec language

### 2. Object 生命周期（阶段 3 + 5 + 7 完成）

| 维度 | 能力 |
|---|---|
| 持久化 | Stone（长期身份 / 数据 / 能力 / 记忆）+ Flow Object（会话运行态）+ thread.json 落盘可恢复 |
| 元编程 | Agent 能用 `program(shell)` 写 `<self.dir>/server/index.ts` 注册新方法，立即 `program(function)` 调用 |
| HTTP 入口 | `POST /api/sessions` / `POST /api/stones` / `POST /api/flows/:sid/continue` / `GET /api/flows/.../threads/...` / `POST /api/stones/:id/call_method` 全套可用 |
| Worker | 后台 polling + 调度 LLM；可控 `workerMaxTicks` / `workerPollMs` |

### 3. LLM provider（阶段 1 + 阶段 10 契约修补）

| Provider | 状态 |
|---|---|
| OpenAI Responses API | 完整支持 input items（含 function_call/output）+ streaming + tools schema |
| Claude Messages API | 阶段 10 重写 transport：function_call → tool_use block, function_call_output → tool_result block, inbox 抽出作 user message。LLM 跨轮看到完整 tool 历史 |
| Provider 切换 | `OOC_PROVIDER` env 控制；client.ts 门面分发 |

### 4. 协作模型（阶段 9 + cross-object talk）

- **cross-object talk**：`talk_window.target` 可指任意 objectId（含 `"user"`）；
  talk-delivery 自动派送 + creator talk_window 在 callee 自动注入
- **user-as-flow-object**：web user 也是一个 flow object，UI 上"用户发消息"等价于
  `user.root.talk_window.say`
- **do_window**：父线程派生子线程；continue / wait / close 三命令；child outbox
  通知父亲。child 多次 end (`do_window.continue` 触发重启) 都能正确唤醒父线程
  （scheduler marker 含 `lastExecutedAt`）

### 5. 数据原语（阶段 9 末尾 + 阶段 10 e2e 工程期）

| 原语 | 能力 |
|---|---|
| `root.grep` | rg + JS fallback；search_window kind=grep；session baseDir 解析相对路径 |
| `root.glob` | Bun.Glob；search_window kind=glob；同上 |
| `root.write_file` | 创建/覆盖 + 自动 spawn file_window；覆盖已有文件返回 `[write_file hint]` 推 edit |
| `root.open_file` | 把文件挂进 context；lines/columns 切片 |
| `file_window.edit` | 精确唯一字符串替换；多 edit 原子提交；失败教育"扩 old 上下文"避退化到 write_file |
| `search_window.open_match` | match 路径 spawn file_window（绝对路径解析） |
| `program(shell/ts/js/function)` | REPL；threadLocalData 跨 exec 共享 |
| `root.end` | thread 收尾 + summary |

### 6. Web app

| 模块 | 能力 |
|---|---|
| SessionCreator | 选 target object + 写 first message 一步建 session |
| ContextSnapshotViewer | 实时看 thread.contextWindows 树 + 每个 window 详情 |
| ChatPanel | RightPanel 内 talk 通道；user-thread 时自动隐藏 |
| Thread switcher | 同 session 内 thread 切换（user.root + callee...） |
| Inline talk composer | ContextSnapshotViewer 内对 talk_window 直接回复 |

### 7. 测试基础设施（阶段 10）

- **Backend e2e** (`tests/e2e/backend/`)：S1–S4 + 公共 fixture + Good/OK/Bad 评分裁判
- **Frontend e2e 骨架** (`tests/e2e/frontend/`)：F1–F5 + Playwright + Vite spawn fixture
- **Integration tests** (`tests/integration/`)：12 个真 LLM 端到端场景
- **Unit tests** (`src/**/__tests__/*.test.ts`)：240+ 通过

### 8. 调试

- 每轮 LLM 调用 `llm.input.json` / `llm.output.json` / `llm.meta.json` 落盘（debug 模式）
- ContextSnapshotViewer 在前端看每轮 LLM 视角
- e2e Bad tier 自动 dump 最近 20 events + outbox + contextWindows.types

---

## 测试套件状态（2026-05-17）

| 测试集 | 通过率 | 备注 |
|---|---|---|
| Unit (`src/**/__tests__/*.test.ts`) | **240+ pass / 0 regression** | 剩 2 个 react/jsx-dev-runtime 缺失是 pre-existing |
| Integration (`tests/integration/*.test.ts`) | **12/12 pass** | 真 LLM 端到端；失败需 retry 1 次（LLM 偶发 API 错） |
| e2e backend (`tests/e2e/backend/*.test.ts`) | **4/4 ≥ OK** | S1 OK / S2 Good / S3 Good / S4 OK |
| e2e frontend (`tests/e2e/frontend/*.pw.ts`) | 骨架完整，未真跑 | 缺 `@playwright/test` 装包 + Chromium |

---

## 待解决问题

按"短期可做 / 中期值得做 / 远期规划"分层。

### 短期（明确路径，可启动）

#### P1. Frontend e2e 真跑

- 现状：骨架 + 5 个 spec + fixture 都在 (`tests/e2e/frontend/*.pw.ts`)，缺环境
- 需做：`bun add -d @playwright/test`、`bunx playwright install chromium`、
  设置 `RUN_FRONTEND_E2E=1`、第一次跑必然有 selector / timing 调整
- 收益：把"前端→后端→LLM→前端"主线真闭合
- 工作量：小（半天起步）

#### P2. Pre-existing react 模块缺失

- 现状：`web/src/domains/chat/components/TuiBlock.test.tsx` 与
  `web/src/domains/files/components/LLMInputJsonViewer.test.ts` 因
  `react/jsx-dev-runtime` 缺失加载失败（计 2 fail / 2 errors）
- 需做：`bun add -D react @types/react` 或检查 web/package.json 与根 package.json
  的依赖配置；确认 web 子目录正确链接 react
- 收益：unit 完全干净
- 工作量：小

### 中期（值得做，但要先评估）

#### P3. `compress` 原语真实现

- 现状：5 原语之一，但 `handleCompressTool` 仍是 stub（返回 "暂未实现"）
- 不能做的事：context 过长无法主动压缩；超长 thread 必然撞 LLM context limit
- 需要的设计：摘要 / 折叠规则（按时间窗 / 按 events 类型 / 按 window 关闭历史）；
  如何标记"已压缩段"让后续 render 不重复展开；是否影响持久化与回看
- 工作量：中-大；需要 spec
- 优先级：取决于实际使用中是否撞过 context limit；当前 OOC 场景大多在限内

#### P4. `wait` Phase 2 — 精确 wakeup

- 现状：`wait(on=<window_id>)` 已结构化（spec 2026-05-17），但 wakeup 仍是宽松
  "任何 inbox 增长就唤醒"
- 不能做的事：`thread` 持有多个 wait 候选时（多 do_window / 多 talk），无关消息
  也会触发唤醒 → LLM 多一次"看一眼再 wait 一次"
- 需要的设计：让 inbox message 携带 `originWindowId`，wakeup 决策匹配 `waitingOn`；
  inject 类无 origin 的消息保持永远唤醒；旧 thread.json 没 origin 字段时的向前兼容
- 工作量：中
- 风险：失活（漏标 origin → 死锁）比 Phase 1 过度唤醒严重得多
- 建议：等真有"多 wait target 频繁竞争"的实际场景后再做；当前可先加观察孔记录
  唤醒来源，积累数据

#### P5. Activator 与 program_window 关系的可观察性

- 现状：阶段 10 改 activator 收集 union 时也看 `program_window.history` 最近 exec
  的 language。功能对，但"激活源"对外不可见
- 不能做的事：debug 工具看不出某条 knowledge 是因为 command_exec 命中还是
  program_window 推断命中——影响"为什么这个 knowledge 这一轮出现"的可解释性
- 需要的设计：`ActivationResult.reason` 字段加细分（`command_exec` /
  `program_window_recent`）；debug-file 把它落到 llm.input.json
- 工作量：小

### 远期（规划层面）

#### P6. 跨 thread / 跨 session 等待

- 现状：`wait` 只看本 thread inbox；跨 session 协作（Alice thread 等 Bob session 事件）
  不支持
- 需要的设计：事件分发的"地址空间" + persistence-aware 唤醒
- 优先级：远；当前 OOC 单租户开发者工具定位无此需求

#### P7. `wait` timeout 语义

- 现状：wait 是无超时的；某些场景（等用户回复但用户离线）会无限挂
- 需要的设计：`wait({on, timeoutMs?})` + scheduler 检测超时把 thread 翻 running
  并注入 timeout system message
- 工作量：小
- 优先级：取决于是否真撞过

#### P8. Frontend 单测覆盖

- 现状：`web/src/domains` 下少量组件测；整体覆盖低
- 需要的工作：组件级单测、Jotai store 测试、router 状态测试
- 工作量：大（持续投入）
- 优先级：等 web app 稳定到生产形态后再投资

#### P9. 跨进程持久化恢复 e2e

- 现状：persistable 单测覆盖；server 杀进程→重启→自动恢复 thread 的全链路 e2e 没
  正式跑过
- 需要的工作：e2e 脚本 spawn server → 触发 thread → kill → 重启 → 验证 thread
  状态完整
- 工作量：中
- 优先级：等真出过"重启丢状态" bug 后再做

### 设计层未结之问

| 问题 | 当前看法 |
|---|---|
| 协议 KNOWLEDGE / window-specific knowledge 文本长度（4-5 KB）是否逼近 LLM 信号过载 | 暂可接受；下次大改前应审视精简 |
| meta/ 概念文档与 src/ 实现对齐是否需要 lint 强制 | 阶段 9 meta-concept-graph 已经在做（`docs/plans/2026-05-15-001-refactor-meta-concept-graph-executable-plan.md`），executable 已完成，其它模块待续 |
| Claude transport 的 `Continue based on...` 兜底在阶段 10 path B 后是否还需要 | 极少触发；可考虑彻底移除并改成 error |
| Legacy `POST /api/flows/:sid/objects` 路径与新 `POST /api/sessions` 并存 | 前者已被 e2e 重构后弱化但仍有用例；下一轮 web app 改造时统一 |

---

## 历史里程碑（链接到 `meta/iteration.doc.js`）

| 阶段 | 完成时间 | 关键成果 |
|---|---|---|
| 1 | 2026-05-09 | thinkable 骨架（LLM 接得通、tool 调得到）|
| 2 | 2026-05-09 | context + 多线程（thread 树 + do.fork/continue）|
| 3 | 2026-05-10 | 单 object 闭环（persistable + scheduler 集成）|
| 4 | 2026-05-10–11 | 9 个 integration test 端到端跑通 |
| 5 | 2026-05-11 | 元编程闭环（agent 自写方法自调用）|
| 6 | 2026-05-11 | debug 落盘（loop_NNN.{input,output,meta}.json）|
| 7 | 2026-05-11 | app server 控制平面（HTTP API 全套）|
| 8 | 2026-05-12 | knowledge module（parser/loader/activator/渲染）|
| 9 | 2026-05-14 | ContextWindow 统一抽象 + Step 2-3 全 window 类型上线 |
| 10 | 2026-05-17 | e2e 工程 + 阶段性契约修补（wait/Claude transport/phantom/scheduler/activator）—— 12/12 integration、4/4 e2e backend |

详细 commit 链路与决策见 `meta/iteration.doc.js`。

---

## 相关文档

- `meta/iteration.doc.js` — 完整迭代历史 + 每阶段判据
- `docs/superpowers/specs/` — 设计规范（含未实施的 Phase 2 工作）
- `docs/superpowers/plans/` — 实施分解
- `docs/solutions/conventions/` — 沉淀的工程约定（fail-loud / reuse-existing /
  llm-perception-as-api-contract / meta-concept-graph）
- `docs/testing/strategy.md` — e2e 测试策略 + Good/OK/Bad 评分方法
- `docs/brainstorms/` — 早期需求 / 设计探讨
