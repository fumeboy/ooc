# Wait requires explicit IO dependency — Implementation Plan

> Spec: `docs/superpowers/specs/2026-05-17-wait-requires-dependency-design.md`
>
> Goal: Phase 1 落地 —— `wait(reason)` → `wait(on, reason?)`，加结构性校验，撤掉本周早些时候为 Bug 2 加的"回复创建者"todo（结构性约束接管它的作用）。
>
> **不在本期**：精确 wakeup（Phase 2，独立 spec）；wait timeout；跨 session 等待。

## 执行节奏

8 个 task 顺序执行；每个 task 一个 commit。先改代码 / 协议（task 1-6）→ 加单测（task 7）→ 真 LLM e2e 回归（task 8）。

Task 8 的 e2e 结果决定要不要回头微调（如错误消息太啰嗦 / talk 合法性判定边界等）。

---

### Task 1: 新 wait schema + ThreadContext.waitingOn 字段

**Files**: `src/executable/tools/wait.ts`、`src/thinkable/context/index.ts`

- [ ] `WAIT_TOOL.inputSchema`:
  - 加 `on: { type: "string", description: "<待 IO 来源 window id>" }`
  - `required: ["on"]`（`reason` 降为可选）
- [ ] `WAIT_TOOL.description` 同步改写（spec §7 短描述）
- [ ] `ThreadContext` 加 `waitingOn?: string`（observability，不参与 wakeup 决策）
- [ ] tsc clean

### Task 2: wait 校验 + reject 五分支

**Files**: `src/executable/tools/wait.ts`

`handleWaitTool` pre-check（spec §3 五条分支）：

- [ ] R1 `on` 缺失 / 非字符串 → reject + 候选枚举
- [ ] R2 `on` resolve 失败（window 不存在 / 非 open） → reject + 候选枚举
- [ ] R3 `on` 类型不合法（非 talk / 非 do） → reject + 候选枚举 + 说明哪些类型合法
- [ ] R4 `on` 是 LLM 自建（非 creator）的 talk_window 且 thread.outbox 里没有 windowId=此 talk 的消息 → reject 并指引"先 say 再 wait"
- [ ] R5 thread 没有任何合法候选 → reject 并强 nudge end command
- [ ] 候选枚举 helper：`listValidWaitTargets(thread)` 返回 `{ id, type, hint }[]`，便于 reject 消息复用
- [ ] happy path：`thread.status = "waiting"`、`thread.inboxSnapshotAtWait = inbox.length`、`thread.waitingOn = on`、return success JSON 含 cited window 信息

### Task 3: 协议 KNOWLEDGE 改写

**Files**: `src/executable/index.ts`

- [ ] `KNOWLEDGE` 中 `wait(reason)：...` 一行改新语义（spec §6）
- [ ] "一轮结束前决策树" 简化（删 bullet 2 的"自驱 root 应 end"提示——结构性约束接管），保留 callee 必须先 say 的提示

### Task 4: 撤掉 talk-delivery 的 todo

**Files**: `src/executable/windows/talk-delivery.ts`

- [ ] 删 `6fd12e3` 加的 "回复创建者" todo spawn 段（spec §6 "可以撤销"）
- [ ] 删 `TodoWindow` import（如果只这里用了）
- [ ] 保留新增的 `generateWindowId` import 如果仍被用（review 后再删）

### Task 5: scheduler / persistence 跟进

**Files**: `src/thinkable/scheduler.ts`、`src/persistable/thread-json.ts`

- [ ] scheduler wakeup 逻辑确认：`thread.waitingOn` wakeup 后清空（同 `inboxSnapshotAtWait`）
- [ ] thread.json 反序列化无需 shim（waitingOn 是可选）；但要确认 toJson / readThread 不丢字段
- [ ] 现有 scheduler 单测如有"thread.status=waiting" 路径的，确认不退化

### Task 6: 文档同步

**Files**: `meta/object/executable/...`（如果有 wait 概念文档）、`meta/iteration.doc.js`

- [ ] grep 找 meta 下提到 `wait(reason)` 的文档，同步新签名
- [ ] `iteration.doc.js` 阶段 10 加一条 entry 记录本次改动

### Task 7: 单测

**Files**: `src/executable/tools/__tests__/wait.test.ts`（新）

- [ ] R1-R5 各一个 reject case，断言 error 字符串包含关键关键词（"on"、合法候选枚举、"改用 end" 等）
- [ ] happy case: `wait(on=<creator talk>)` → thread.status=waiting、waitingOn=该 id、success 消息
- [ ] happy case: `wait(on=<do_window>)` → 同上
- [ ] persistence 往返：waitingOn 序列化 / 反序列化稳定（可写在 persistable 测试里）

### Task 8: 真 LLM e2e 回归

**Run**:
- [ ] `RUN_BACKEND_E2E=1 bun test tests/e2e/backend` 跑 S1-S4
- [ ] S1 至少跑 5 次记 OK 率（目标 ≥4/5）
- [ ] S3 仍 Good
- [ ] `bun test tests/integration` 看原本 6 个 "status 应 done" 的 fail 是否转通过
- [ ] 任何回归 / 新出现的 Bad → 回到 Task 2 调错误消息或 Task 3 调协议文本，记录在 plan 末尾

落地完成后在 `meta/iteration.doc.js` 阶段 10 加一条总结，引用本 plan 与 spec。

---

## 回溯

- Task 4 撤 todo 是 high-confidence 改动（结构性约束更强）；如 Task 8 e2e 表明 todo 仍提供边际价值，可回退（git revert 单 file）
- Task 2 错误消息形态如 e2e 显示 LLM 自纠失败，调措辞（参考 `llm-tool-handlers-fail-loud-2026-05-15.md`）
- 若 R4（LLM 自建 talk 必须 say 过）在真用例里太严，放宽为"talk_window status=open 即合法"

## Task 8 实测结果（2026-05-17）

| 套件 | 修复前 | 修复后 | 备注 |
|---|---|---|---|
| e2e S1 rename | Bad ×3 (LLM 卡 waiting) | **OK** | thread.status=done；LLM 走 open_file→grep→write_file→say×2→end |
| e2e S2 read-only | Good | Good | 无变化（之前就走 say+end） |
| e2e S3 multi-turn | Good | Good | 无变化 |
| e2e S4 invalid-edit | Bad | Bad | 与 wait 无关：LLM 偏好 write_file 全覆盖；属 edit 引导问题 |
| integration | 1 → 6 pass / 11 → 6 fail | 6 pass / 6 fail | 与上次一致；剩余 fail 是其它独立 LLM-behavior 问题（见下） |

剩 6 个 integration fail 不再是"wait 漂移"，而是更细的多种 root cause：

1. **"Expected done, Received waiting"**：integration `makeThread()` 默认注入 phantom creator do_window
   （targetThreadId 指向不存在的 thread），新 wait 校验把它视作合法候选 → LLM 合法 wait 在上面 →
   永远等不到唤醒。**这是测试 fixture 设计 bug**：自驱 root 不应有 creator window。
   修法：integration tests 改用 `makeThread({ skipCreatorWindow: true })`。**不在本 spec scope**。
2. **"Expected done, Received running"**：LLM 用满 maxTicks 没收尾。属任务步数预算与 LLM 推理效率问题。
3. **"用户连续发送 Continue ... 无任何先前任务上下文"**（meta-programming）：LLM 在多轮后丢失 prompt 上下文，
   误把后续 Continue 当成新会话起点。这是 context 渲染 / inbox 累积的独立问题。

**结论**：wait-requires-dependency Phase 1 目标达成 —— "LLM 无理由 wait 卡死"这条漂移路径被结构性
关闭。S1 OK 是直接证据。其余测试残余 fail 是新暴露的独立 bug，**应各自立 spec/plan 处理**，不应
回退本期改动。
