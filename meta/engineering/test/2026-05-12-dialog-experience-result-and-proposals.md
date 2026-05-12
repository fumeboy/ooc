---
type: engineering-test
date: 2026-05-12
kind: real-agent-dialog
session: dialog-1778520615266
---

# 真实 Agent 对话体验：结果与后续提案

## 背景

承接 `2026-05-11-app-server-control-plane-result-and-todo.md`：在 app-server 控制面落地、knowledge 模块自动激活完工之后，通过 `scripts/dialog-experience.ts` 跑一次真实的多轮对话，覆盖 shell-basics / meta-program / data-persistence / self-modify / synthesis / edge-cases / wrap-up 七大主题、15 轮。目的是把 OOC 系统作为日常 Agent 工具实际使用，发掘工程缺口。

## 对话结果概览

- 总轮次：15
- 成功率：15 / 15（最初一版有 0 / 15 灾难性失败，定位并修复 5 处底层 bug 之后才达成）
- 关键能力验证：
  - `program(shell)`：pwd / ls / wc -l / 失败命令 stderr+exit code → ✅
  - `program(function)`：调用 stone 注册的 server method → ⚠️（见 P1）
  - `program(ts)` + `self.setData/getData`：counter 持续累加 1→2→3→写入 final_counter ✅
  - 自我修改：往 self.md 追加段落 → ⚠️（见 P2）
  - 边界：调不存在 method 时返回 exit 1 + 明确错误信息 ✅

## 本次会话期间已修复的工程问题

按对话过程中观察到的问题倒序记录，所有改动均已 commit，单点改动小、不引入新概念：

1. **createFlowObject 自动跑空 events thread 导致 status=failed 锁死**
   - commit: `bb634cf`
   - 表现：dialog 启动 15 轮全 failed
   - 修：`createFlowObject` 仅在 `initialMessage` 非空时 enqueue job + seed events；`continueThread` 把 failed 也翻回 running

2. **多轮对话缺 continue API**
   - commit: `da4de53`
   - 修：POST `/api/flows/:sid/objects/:oid/threads/:tid/continue`，把 thread 翻回 running 并入队新 run-thread job

3. **app-server 错误透传成通用 500**
   - commits: `a3f397f`、TODO 3/4 中的 callMethod & debug 路由
   - 修：`AppServerError` → `ERROR_HTTP_STATUS` map（404 / 400 / 409 / 500）

4. **`flows.resumeSession` 只清 pause-store、不扫 paused thread**
   - commit: `075f092`
   - 修：扫 `flows/{sid}/objects/*/threads/*` 的 paused 状态，逐个入队 resume-thread job

5. **worker tick 上限硬编码 10**
   - commit: `4a78e38`
   - 修：配置化 `workerMaxTicks`，env `OOC_WORKER_MAX_TICKS`，默认 15

6. **submit 后 LLM 同 tick close 把 result 抹掉**
   - commit: `8c4d13e`
   - 修：submit 注入 `[form executed]` 时附加显式警告："等到下一轮 think 再读 result，同一轮 close 会丢"

7. **program.shell 没有把 self.dir 透出去，Agent 把 server/index.ts 写到 OOC 项目根**
   - commits: `fd7c3fe`、`9f6fc07`、`b2d31ac`、`ff1b8a6`
   - 表现（dialog 实测）：Turn 4 写 server/index.ts 到 `./server/index.ts`（项目根）；Turn 10 写 self.md 同样落到项目根
   - 修：`program.shell` 通过 `Bun.spawn.env` 注入 `OOC_SELF_DIR=baseDir/stones/{objectId}`；同步更新 program.KNOWLEDGE 和 dialog-experience.ts 用 `"$OOC_SELF_DIR/..."` 引用；新增 2 个单测；submit.doc.js inject 示例同步

## 已观察但尚未落地的优化（待确认）

下面这几条改动较大、或涉及新概念，先记录、由你确认后再做：

### P1. `program(function=...)` 的"刚写完的 server method 立即可调用"语义

**现象**：Dialog Turn 5（user：调 wordcount）实际 6 个 think loop 才完成；Turn 6 / 11 同样大量 loop。深层原因：
- Agent 用 `program(shell)` 写 server/index.ts（但写错位置，落到项目根）→ `loadLlmServerMethods` 在 `stones/{oid}/server/index.ts` 找不到 → 返回 "method 不存在" → Agent 用 shell+node 直接验证逻辑代替
- 即便 OOC_SELF_DIR 修好之后，loader 用 mtime 缓存：第一次 stat 文件不存在会返回 undefined，但**第二次**写入文件后是否会立即反映？目前 loader 每次 stat 重新做、不缓存 ENOENT，所以理论上写完即可调，但需补 e2e 验证

**提案**：加一个集成测试，串起 "写 server/index.ts 文件 → 立刻 program(function) 调用 → 应该返回新方法" 的完整链路（覆盖 ENOENT→存在的过渡），作为 hot-reload 契约保证。涉及新测试文件，但不引入新概念。

### P2. self.md / data.json 是否在 stone 层暴露 `self.appendFile` / `self.readFile`

**现象**：Turn 10 让 Agent 往 self.md 追加段落。Agent 第一反应是 `program(shell) echo >> self.md`，这就触发 P1 风险（路径问题）。如果通过 OOC_SELF_DIR 正确解析，shell 也能做，但 ts 中**没有**直接的 `self.appendFile(path, text)` 方法可调。

**提案**：在 `createProgramSelf` 加 `self.appendFile(relPath, text)` / `self.readFile(relPath)`，把"操作 stone 目录内文件"从 shell 路径中独立出来，使 ts 模式也能完成。但这是新概念（self.fs?），等你确认是否要引入。

### P3. TODO 5（test 报告原项）：worker 进程内状态升级为可恢复 job 队列

**现状**：JobManager / PauseStore 都是 in-memory；worker 重启即丢失。
**提案**：引入 `jobs.jsonl` 落盘（kind / sessionId / objectId / threadId / status / createdAt / startedAt / finishedAt）。启动时扫描 status=pending|running 的项 → 重新入队。
**为什么先记不做**：磁盘格式、状态机扩展、与 PauseStore 的关系都需要讨论；属于"中等规模 + 引入新概念"，留给你决定语义边界。

### P4. TODO 2（test 报告原项）：真实 Agent 集成测试稳定性

**现状**：`src/integration/__tests__/multi-round.test.ts` 已存在并稳定 15 轮，但**只用 mock LLM**。而 dialog-experience.ts 用真 Claude proxy，需要环境变量 + 长时延（一次 5+ 分钟），不适合放进 `bun test` 主流程。
**提案**：把 dialog-experience.ts 改造为 `scripts/` 下的"半自动 smoke test"，加 CI nightly 钩子或人工触发；同时把 mock LLM 集成测试再加 2~3 个场景（同 tick close、function path、resumeSession）。
**为什么先记不做**：CI 流程调整、proxy 凭据托管是较大决定。

## 真实日志与产物位置

- 对话进度日志：`/tmp/dialog-out.log`（本机会话内）
- 自动报告：`/Users/zhangzhefu/x/ooc-2/ooc/.ooc-world-test/dialog-1778520615266-report.md`
- 全 events 录像：`.ooc-world-test/flows/dialog-1778520615266/objects/assistant/threads/root/thread.json`（189 events）
- 副产物：`.ooc-world-test/stones/assistant/data.json` 包含 `{ counter: 3, final_counter: 3 }`

## 验收

- `bun test src` → 183 pass / 3 skip / 0 fail
- `bunx tsc --noEmit` → exit 0
- 本会话累计 commits：`origin/ooc-2..HEAD` 共 16 个（不含 8 个来自 knowledge 模块本地分支的旧 commit）
