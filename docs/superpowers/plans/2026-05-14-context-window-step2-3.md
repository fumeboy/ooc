# Context Window Step 2 + 3 Implementation Plan

> Goal: 把 spec `2026-05-14-context-window-unification-design.md` 中 **Step 2 / Step 3** 一次性落地。

> **节奏：** 与 Step 1 相同——先动产品代码，最后统一修测试 + 集成测试。每个 Task 独立 commit。

---

## Step 2

### Task A — talk_window

**Files:** `src/executable/windows/talk.ts`（新）、`src/executable/commands/talk.ts`、`src/executable/windows/index.ts`、`src/app/server/modules/flows/service.ts`

- root.talk command 改为：submit 副作用 = 创建 talk_window（target=user, conversationId=windowId）
- 注册 talk_window：commands = { say, wait, close }
  - say (msg, wait?) — 写 thread.outbox + 标记 source="talk" + windowId
  - wait — 父线程进 status=waiting
  - close — 仅释放 window，不影响 user 端
- ThreadMessage 字段扩展：source 加 "talk"；新增 windowId / replyToWindowId（向后兼容）
- 渲染：talk_window 的 transcript 按 outbox.windowId === self.id 与 inbox.replyToWindowId === self.id 过滤
- 控制面：`flows/service.continueThread` 接受可选 `targetWindowId`，写到新 inbox 消息的 replyToWindowId
- HTTP API `POST /api/flows/:sid/objects/:id/threads/:tid/continue` 接受 `target_window_id` 参数
- Commit `feat(talk): produce talk_window with say/wait/close + user-reply routing`

### Task B — program_window

**Files:** `src/executable/windows/program.ts`（新）、`src/executable/commands/program.ts`、`src/executable/server/self.ts`、`src/executable/server/types.ts`

- 新 type ProgramWindow：history: ProgramExecRecord[]
- root.program command 改为：submit 副作用 = 创建 program_window 并立即执行第一次 exec（首次结果进 history[0]）
- 注册 program_window：commands = { exec, close }
  - exec (language, code | function, args) — 起独立 sandbox（与现有 program 同样路径），结果追加到 history
  - close — 释放 window
- ProgramSelf 扩 getThreadLocal/setThreadLocal — 通过 thread.threadLocalData 字典；ts/js sandbox 可读写
- 移除 program command 单次副作用模式；C 规则仍能让 LLM 一步发起 program_window + 首次 exec
- 渲染：program_window 显示 history 摘要（每条 exec 一行：language + code 首行 + ok 标记）
- Commit `feat(program): upgrade to program_window with REPL + threadLocalData`

### Task C — file_window / knowledge_window

**Files:** `src/executable/windows/file.ts`（新）、`src/executable/windows/knowledge.ts`（新）、`src/executable/commands/open-file.ts`（新）、`src/executable/commands/open-knowledge.ts`（新）、`src/executable/commands/index.ts`

- 新 root command `open_file` (args: path, lines?, columns?) → file_window（C 规则总命中）
- 新 root command `open_knowledge` (args: path) → knowledge_window
- file_window 注册 commands：set_range / reload / close
- knowledge_window 注册 commands：reload / close
- 渲染：file_window 读文件正文（按 lines/columns 切片，32KB 截断）；knowledge_window 调 loader 拿 doc 正文（8KB 截断）
- 复用旧 render.ts 中已有的 truncateFileBody / truncateKnowledgeBody 工具函数
- knowledge activator 同时把"显式打开的 knowledge_window 的 path"算作激活源（取代旧 pinnedKnowledge）
- Commit `feat(windows): file_window / knowledge_window restoring open_file / open_knowledge`

### Task D — 顶层 inbox/outbox 渲染收敛

**Files:** `src/thinkable/context/render.ts`

- inbox/outbox 顶层渲染改为：仅当某条消息**没有任何 window 视图收纳**时才显示
- talk_window 的 transcript 过滤逻辑加进 collectWindowConsumedMessageIds
- 该收敛使得 LLM 同一条消息只看到一次（避免顶层兜底 + window 内重复）
- Commit `refactor(context): inbox/outbox top-level fallback now respects all window views`

---

## Step 3

### Task E — 移除持久化兼容代码 + 旧字段在源码中彻底消失

**Files:** `src/persistable/thread-json.ts`

- 删除 `LegacyThreadJson` 类型与 `migrateLegacyThread` 函数
- readThread 直接 `JSON.parse(...) as ThreadContext`，丢失字段静默丢弃
- 删除 `legacyFormToCommandExecWindow`
- initContextWindows 兜底仍保留（防止旧数据缺 creator window 时崩）
- Commit `chore(persistable): remove legacy thread.json migration shim (Step 3)`

### Task F — meta 文档 final pass

**Files:** `meta/object/executable/actions/commands/program.doc.js`、`talk.doc.js` 已存在；新增 `open-file.doc.js` / `open-knowledge.doc.js`；index.doc.js 列表

- 更新 program.doc.js（program_window）
- 更新 talk.doc.js（talk_window + say/wait/close）
- 新增 open_file / open_knowledge command 文档
- iteration.doc.js 追加阶段 9 完成回写 + Step 2/3 节点
- Commit `docs(meta): align command docs with Step 2/3 windows`

### Task G — 集成测试 prompt 与断言对齐

**Files:** `tests/integration/*.integration.test.ts`

- 现有 prompts 改为新 ContextWindow 协议下的调用形式（continue 走 do_window.continue 等）
- 断言改为 contextWindows 残留检查 / 新 window 类型存在性
- Commit `test(integration): adapt prompts and assertions to Step 2/3 model`

### Task H — 测试统一收口

**Files:** 各 __tests__/

- 新 window 类型的生命周期单测（talk_window / program_window / file_window / knowledge_window 各 1 个）
- 持久化兼容删除后 readThread 的最小测试
- 跑 `bun test src/` 全绿；跑 integration（需 .env）
- Commit `test: window-type lifecycle coverage (Step 2/3)`

---

## 完成判据

1. `bun test src/` 全绿
2. `bunx tsc --noEmit` 无新增错误
3. 全文搜索：`activeForms` / `pinnedKnowledge` / `waitingType` / `awaitingChildren` 在 `src/` 与 `meta/` 中**完全消失**（包括迁移兼容代码）
4. LLM 可通过新 commands 创建 talk_window / program_window / file_window / knowledge_window
5. user 通过 control plane 给特定 talk_window 回复，消息正确路由到该 window 视图
6. program_window 内多次 exec 通过 threadLocalData 共享 ts/js 数据
