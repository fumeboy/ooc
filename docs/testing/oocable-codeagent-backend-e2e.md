# OOC as CodeAgent — backend e2e tests

> 必读前置：`docs/testing/strategy.md`。本文档不重复策略 / 观察孔 / Good-OK-Bad 判定规则；只列出后端入口下的具体场景集与触发方式。

---

## 范围

测试对象：**HTTP API + worker + LLM + 文件系统 + thread.json**。即不打开浏览器，纯通过 HTTP 触发 OOC，对 worker 执行后的副作用断言。

测试**不**关心：
- 前端 React 组件 / UI 渲染（属 frontend-e2e 范畴）
- 单元级 service 行为（属各模块 `__tests__/service.test.ts`）

每个场景的判定按 `strategy.md §2`：Good / OK / Bad；通过门槛 ≥ OK。

---

## 工具栈

| 项 | 选择 | 理由 |
|---|---|---|
| 测试框架 | bun:test | 现有栈 |
| HTTP 触发 | Elysia `app.handle(new Request(...))` 直调 | 不必起真端口；与 `real-app-server.test.ts` 一致 |
| LLM | 真 LLM via `.env`（`OOC_API_KEY`/`OOC_BASE_URL`/`OOC_MODEL`）；env 缺失自动 skip | 主线 e2e 必须真 |
| baseDir | `mkdtemp` 每场景一份；测试后清理 | 隔离 |
| Worker | `workerEnabled: true`，`workerPollMs: 50ms` | 让 LLM 真的被调度 |
| 等待完成 | `waitFor(jobId, status==done|failed)` helper | 与 `real-app-server.test.ts` 同 |
| Gate | `RUN_BACKEND_E2E=1` 环境变量 | 默认 skip；CI 与本地有意运行才跑 |

测试文件位置：`tests/e2e/backend/*.e2e.test.ts`。

---

## 公共 fixture (`tests/e2e/backend/_fixture.ts`)

提供：
- `loadRealEnv()` — 从 `.env` 加载 `OOC_*`
- `startApp({ baseDir?, seedFiles? })` — `buildServer` + 临时 baseDir + 可选 seed 源码文件
- `postJson(app, path, body)` / `getJson(app, path)` — fetch helper
- `seedSession(app, sid, target, initialMessage)` — POST /api/sessions wrapper
- `continueAndWait(app, sid, text)` — POST continue + 等 callee job done
- `readCalleeThread(baseDir, sid, objectId, threadId)` — 验机制用
- `scoreScenario({ thread, files, observations, rules }) → { tier, details }` — 通用评分裁判；接受场景自带的 Good/OK 规则函数，返回最终档 + 关键观察值；测试断言 `tier !== "Bad"`，并 `console.log(details)` 让 CI 留趋势

---

## 场景集索引

| ID | 文件 | 类别 | 一句话 |
|---|---|---|---|
| S1 | `backend-rename-symbol-via-edit.e2e.test.ts` | 改文件 | 用 file_window.edit 重命名跨文件函数 |
| S2 | `backend-read-only-search.e2e.test.ts` | 纯读取 | 用 root.grep 找 deprecated 用法并报告 |
| S3 | `backend-multi-turn-followup.e2e.test.ts` | 多轮对话 | 第二轮让 assistant 在已有文件上加函数 |
| S4 | `backend-invalid-edit-recovery.e2e.test.ts` | 失败回路 | 多重匹配触发 edit 错误；验 LLM 能扩大上下文重试 |

每个场景跑完后必须 `tier !== "Bad"`；CI 单场景允许重试 1 次（见 `strategy.md §5`）。

---

## S1 — `backend-rename-symbol-via-edit.e2e.test.ts`

**类别**：改文件

**Seed**：`baseDir/src/foo.ts` 含两个函数 `helperA` / `helperB`，互相调用一次。

**用户消息**：`"请把 src/foo.ts 中的函数 helperA 重命名为 helperZ；其它调用点也跟着改。改完告诉我做了什么。"`

**Good**：
- thread.status = `done`
- src/foo.ts 中 `helperA` 出现次数 = 0；`helperZ` 出现次数 = 改前 `helperA` 次数
- assistant outbox 至少 1 条非空回复，回复中提到 `helperZ`
- LLM 至少 open 过一次 `file_window.edit`（events 可查）
- **未** 使用 `program(language="shell")` 修改文件

**OK**：
- 文件改对 + assistant 回复了，但用了 `program(shell, sed -i ...)` 或 `write_file` 完整覆盖
- 或 file_window.edit 重试 ≥ 2 次后才成功

**Bad**：
- 文件没改 / 改错 / 多改少改
- thread 卡在 running 或 waiting
- assistant 没回复 / 回复为空 / 回复语义错误

---

## S2 — `backend-read-only-search.e2e.test.ts`

**类别**：纯读取

**Seed**：`baseDir/src/{a,b,c}.ts` 各含若干 `deprecatedFoo` 调用，已知总数 N。

**用户消息**：`"找出 src/ 下所有用到 deprecatedFoo 的位置，告诉我有几处、分别在什么文件什么行。不要修改代码。"`

**Good**：
- thread.status = `done`
- assistant outbox 回复中数字与实际 grep 结果一致（= N）
- LLM 至少 open 过一次 `root.grep`
- 所有文件未被修改（content 等价于 seed 内容）
- 未 open 过 file_window.edit / write_file

**OK**：
- 数字 / 位置正确，但走 `program(shell, grep -rn ...)` 而非 `root.grep`
- 或 grep 调对了但没用 open_match，回复中靠 LLM 自己复述

**Bad**：
- 数字错 / 位置错 / 没回复
- 修改了文件（哪怕只是空白）

---

## S3 — `backend-multi-turn-followup.e2e.test.ts`

**类别**：多轮对话（cross-object talk 真链路）

**Seed**：`baseDir/src/calc.ts` 一个简单 `add(a, b)` 函数。

**用户消息 #1**：`"src/calc.ts 里 add 是怎么实现的？"`  
**用户消息 #2**（在 #1 回复之后发）：`"那加一个 sub(a, b) 函数。"`

**Good**：
- 两轮均 callee thread.status = `done`
- 回复 #1 中提到 add 的实现细节
- 第二轮后 src/calc.ts 包含 `sub` 函数定义
- user.root.outbox 有 2 条 user 消息；user.root.inbox 有 2 条 assistant 回复（cross-object talk 双写正确）
- assistant 复用了同一个 creator talk_window 应答（未为第二轮 open 新的 talk_window）

**OK**：
- 两轮完成，但 assistant 为第二轮 open 了新 talk_window（漂移）
- 或两轮完成但 sub 写位置奇怪 / 命名不规范

**Bad**：
- 第二轮 assistant 不回复 / 文件未更新
- 双写不一致（caller.outbox.length ≠ callee.inbox 中 source=user 的数量）

---

## S4 — `backend-invalid-edit-recovery.e2e.test.ts`

**类别**：失败回路

**Seed**：`baseDir/src/dup.ts` 含 `count = 0` 在多处（让 file_window.edit 的"唯一匹配"规则首次必失败）。文件首行有 `// 第一处计数初始化` 注释帮助 LLM 定位。

**用户消息**：`"把 src/dup.ts 里【第一处】的 count = 0 改成 count = 1，其它出现的不要改。"`

**Good**：
- thread.status = `done`
- src/dup.ts 中"第一处 count = 0"被改为 count = 1，其余未改（精确 diff 可验）
- LLM 在收到首次 edit "matches N times" 错误后，主动扩大 `old` 上下文（含前后行）重试，最终 file_window.edit 成功
- assistant 在 outbox 解释了发生了什么、最终怎么做的

**OK**：
- 文件正确改对 + 有回复，但 LLM 退化到走 `program(shell)` 或 `write_file` 全覆盖
- 或 LLM 反复尝试 file_window.edit ≥ 4 次才成功

**Bad**：
- 文件改错位置 / 改多了 / 没改
- LLM 收到错误后 close 了 file_window 重 open 也不解决
- thread 卡 running / waiting / failed
- 收到错误后 assistant 直接 end，没回复 user

---

## 推进顺序建议

1. 先写 fixture 与一个最小骨架（S1），跑通"真 LLM + 真 server + 真 worker"链路 → 这一步本身就能挡住 cross-object talk 的回归
2. 然后 S3（多轮 talk）— 验另一条独立通路
3. S2 / S4 — 是更专注 OOC 设计意图（grep / edit 错误回路）的探针

---

## 与现有测试的关系

- `tests/integration/*.integration.test.ts`（12 个）：保留。这些是"绕过 server 直接构造 thread + 调 LLM"的 LLM-行为单测，与本 e2e 套件**互补不替代**。当 e2e 出现 Bad 时，可以下到 integration test 层定位是 LLM 行为还是 OOC 实现问题
- `real-app-server.test.ts`（1 个）：保留作 smoke。它走老 `createFlowObject + initialMessage` 路径，本 e2e 套件走新 `seedSession` + cross-object talk 路径，两条都要绿

