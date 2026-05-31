# OOC-4 L6b：do agent-facing 塌缩（do_window → root.do_* + active-do/parent_task 自视切片）

> **For agentic workers:** 执行 sub-agent **不要自己 commit**（Supervisor 整合提交）。最难 B 类。镜像 L5c talk Phase C，但**更保守**：do 的内部机制（continueCommand/render hook/filterMessages/scheduler/childThreads 树/share）全部 **keep-not-delete**，类型擦除延 L6c。本 plan 已吸收 feasibility-reviewer NO-GO 的 4 Critical + 2 High（见末尾「review 消解表」）。

**Goal:** do_window 的 **agent 交互面**塌缩——agent 不再经 do_window 方法交互（render 把 do 从 context_windows 过滤），改 root.do/do_continue/do_close + active-do 自视切片（parent 看 children）+ parent_task 自视切片（child 看 parent 任务/回报口）。**do_window 降为内部数据**（transcript 源 + consumed 标记 + 路由 + end 的 creator reply），erase 延 L6c。

**核心路线（与 talk Phase C 逐条对齐）**：
| talk Phase C 做法 | do L6b 对应 |
|---|---|
| render.ts:230 `renderContextWindowsNode` 过滤 `w.type !== "talk"` | 加 `&& w.type !== "do"` |
| 自视 `<talks>` 切片渲会话 | 自视 `<active_children>`（parent）+ `<parent_task>`（child）切片 |
| `collectWindowConsumedMessageIds` talk 用 peerObjectId 标记保留 | **保留** do 分支（filterMessagesForDoWindow），避免兜底重复 |
| root.talk 替 say/wait/close | root.do_continue/do_close 替 do_window.continue/close（**do fork 已是 root 方法**）|
| wait.ts talk-peer 候选（按 peerObjectId）| wait.ts do 候选改按 **targetThreadId（childThreadId）**|
| 保留 TalkWindow 类型/creator/service 路由（Phase D 擦） | 保留 DoWindow 类型/renderDoWindow/continueCommand/方法注册/share（L6c 擦）|

**与 talk 的关键差异（同 object，非 cross-object）**：do 的 parent-wake 主路径是 **scheduler.emitChildEndNotifications**（向下迭代 parent.childThreads，**reload 安全，不需 `_parentThreadRef`**，scheduler.ts:61-89）——**完全不动**。do 不碰 worker.ts。child→parent **显式 reply** 走 findThreadInScope 上行（依赖运行时 `_parentThreadRef`），这是 helpers.ts:52-53 承认的**预存 reload gap**；本 plan 在 **readThread 补 persistable supplement**（正是该注释指定的归属点），不重写 do 持久化模型（那是 L7）。

**基线**（L6a 后）：1073 pass / 0 fail / 3 skip，tsc 0。安全网：scheduler.test + do-thread-tree.test（do_window 方法保留 → **原样应绿**）+ 新增 do reload-crossing wait/wake e2e。

---

## 设计决策

### D1 render 过滤 do（镜像 talk）
- `src/thinkable/context/render.ts:230`：`renderContextWindowsNode` 的 `all` filter 从 `w.type !== "talk"` 改为 `w.type !== "talk" && w.type !== "do"`。注释补 do（同 talk：agent 经 `<self_view>` 看 children/parent，DoWindow 类型 L6c 才擦）。
- **保留** `collectWindowConsumedMessageIds` 的 do 分支（render.ts:247-249，filterMessagesForDoWindow）——do 消息仍标记 consumed，不落兜底 inbox/outbox。（Critical 3 消解：不删 filterMessagesForDoWindow。）
- **保留** renderDoWindow 注册（dead hook，永不被调用因 do 已过滤；assert 仍过——hook 存在。L6c 删 hook + 类型时一并处理）。**不动 assert 机制**。

### D2 active-do + parent_task 自视切片（self-view.ts）
`renderSelfView` 加两段（复用 `filterMessagesForDoWindow` 渲 transcript，避免重写过滤逻辑）：
- `renderActiveDoSlice(thread)`：遍历 `thread.contextWindows` 里 `type==="do" && !isCreatorWindow && status==="running"` 的 do_window（= parent 对 child 的视图）。每个渲 `<child thread_id=<targetThreadId> status=<childThread.status>>`（childThread 从 `findChild(thread, targetThreadId)` 取 status）+ 最近 N 条 transcript（filterMessagesForDoWindow，截断）。空→不渲 `<active_children>`。**附 hint**：「追加消息用 do_continue(target=<thread_id>,...)；关闭用 do_close(target=<thread_id>)」。
- `renderParentTaskSlice(thread)`：找 `type==="do" && isCreatorWindow` 的 creator do_window（= child 对 parent 的视图）。渲 `<parent_task parent_thread_id=<targetThreadId>>` + 最近 N 条 transcript。**附 hint**：「向 parent 回报用 do_continue(target=<parent_thread_id>, msg=...)」让 child 知回报口（替代被 render-skip 的 creator do_window）。空→不渲。
- 段序：plan→talks→relations→active_children→parent_task→todos（合理即可，与现有切片并列）。

### D3 root.do_continue / do_close（替 do_window.continue/close 的 agent 面）
抽共享核心，避免与 continueCommand 重复逻辑：
- 新建 `src/executable/windows/do/deliver.ts`：`deliverDoMessage(thread, targetThreadId, content, wait): string | undefined`——把 executeDoWindowContinue 的 inbox-write + done→running 重启 + outbox + wait + notify 核心搬出（**去 parentWindow 依赖**，直接用 targetThreadId）。含 Critical 4 兜底：findThreadInScope 失败且 `targetThreadId === thread.parentThreadId` 时，`notifyThreadActivated({...thread.persistence!, threadId: thread.parentThreadId})`（parent 被调度，经 emitChildEndNotifications 学到 child 状态），并返回 explicit 提示串（非静默）。
- `command.continue.ts`：executeDoWindowContinue 改为 `deliverDoMessage(thread, window.targetThreadId, content, wait)`（**continueCommand 保留**，end.ts:3 import 不破——Critical 1 消解）。
- 新建 `src/executable/windows/root/command.do-continue.ts`：`doContinueCommand`（root method `do_continue`）——args: `target`(threadId, 必填) / `content`(必填) / `wait`(可选)。`deliverDoMessage(thread, target, content, wait)`。in-character knowledge（`internal/executable/do_continue/basic` ≥20 字符，父→子追加 / 子→父回报双向说明）。
- 新建 `src/executable/windows/root/command.do-close.ts`：`doCloseCommand`（root method `do_close`）——args: `target`(childThreadId)。找 `contextWindows` 里 `type==="do" && targetThreadId===target` 的 do_window，`archiveDoWindowChild(thread, doWindow)`。找不到→返回 explicit 串。knowledge ≥20 字符。

### D4 wait.ts do 候选迁 childThreadId（Critical 2）
- `listValidWaitTargets`（wait.ts:51-59）：do 候选 `id` 从 `w.id` 改为 `w.targetThreadId`，hint 改「child=<childThreadId> — 等子线程回报」。仅非 creator 的 do_window（parent 侧；creator 是 child 侧回报口，不作 wait child 用）→ 加 `!w.isCreatorWindow` 守卫。
- `handleWaitTool`：在 talk-peer 匹配（wait.ts:171）后加 do-child 匹配 `candidates.find(c => c.kind==="do" && c.id===onRaw)` → `enterWaiting(thread, onRaw, args, "do child="+onRaw)`。保留下方 window-id 路径给 creator talk_window（do 不再走 findWindow(onRaw) 因 onRaw 现是 threadId 非 window id）。
- 文案：description / R5 nudge 把「do_window id」措辞改「子线程 id」。
- `wait.test.ts`：do 相关断言（:46/:73/:106-217 任何按 do_window id 的）迁为按 childThreadId。

### D5 readThread 重建 `_parentThreadRef`（Critical 4，persistable supplement）
- `src/persistable/thread-json.ts` readThread（:97-107 restored 之后、return 之前）：递归遍历 `restored.childThreads` 树，对每个 child `Object.defineProperty(child, "_parentThreadRef", {value: <its parent in loaded tree>, enumerable:false, writable:true, configurable:true})`。这让 worker re-enqueue parent（readThread(parentId)）后，树里 child 的上行 findThreadInScope 可用——修复 in-tree-reload 的 child→parent 显式 reply。（truly-standalone child〔readThread(childId) 无 parent 树〕仍靠 D3 的 notify 兜底。）
- 兑现 helpers.ts:52-53「recovery 由 persistable 层负责」的契约。

### D6 ROOT_METHODS / knowledge（High 2）
- `root/index.ts`：ROOT_METHODS 加 `do_continue`/`do_close`（count +2）。ROOT_KNOWLEDGE 方法表补两行。
- `commands.test.ts:33-54` getOpenableCommands `toEqual([...])` 精确表加 `do_close`/`do_continue`（sorted 位）；`commands.test.ts:57-64` 每 root method knowledge `internal/executable/<m>/basic` ≥20 字符——两新方法须满足。

---

## File Structure
```
src/thinkable/context/render.ts                    # 改：renderContextWindowsNode filter 加 w.type!=="do"（保留 consumed do 分支 + renderDoWindow 注册）
src/thinkable/context/self-view.ts                 # 改：renderActiveDoSlice + renderParentTaskSlice + 插入 renderSelfView
src/executable/windows/do/deliver.ts               # 新增：deliverDoMessage 共享核心（含 Critical 4 兜底 notify）
src/executable/windows/do/command.continue.ts      # 改：executeDoWindowContinue 调 deliverDoMessage（continueCommand 保留给 end.ts）
src/executable/windows/root/command.do-continue.ts # 新增：do_continue root 方法
src/executable/windows/root/command.do-close.ts    # 新增：do_close root 方法
src/executable/windows/root/index.ts               # 改：ROOT_METHODS +do_continue/do_close + ROOT_KNOWLEDGE 表
src/executable/tools/wait.ts                        # 改：do 候选 id→targetThreadId + handleWaitTool do-child 匹配 + 文案
src/persistable/thread-json.ts                      # 改：readThread 重建 childThreads 树的 _parentThreadRef
meta/object.doc.ts                                  # 改：do_window 节点（agent-facing 塌缩，镜像 talk 表述）+ method count
# 测试：
tests/e2e/backend/do-parent-child-wait-wake.e2e.test.ts  # 新增：reload-crossing 安全网（先写，RED gate）
src/executable/tools/__tests__/wait.test.ts          # 迁：do 候选按 childThreadId
src/executable/__tests__/commands.test.ts            # 迁：toEqual 加 do_continue/do_close + knowledge
# do-thread-tree.test / scheduler.test / do-fork-and-collect.integration / do-continue-after-done.integration
#   / sharing.test / commands-execution.test：do_window 方法+share 全保留 → 应原样绿；仅核对 render-skip 是否波及断言 do_window 出现在 context_windows 的用例
```

---

## Task（分阶段，每阶段保绿；安全网 e2e 先行）

### Task 1：do reload-crossing 安全网 e2e（先写，确立 RED→GREEN gate）
**Files:** Create `tests/e2e/backend/do-parent-child-wait-wake.e2e.test.ts`
- [ ] 场景（后端直调，参考 agent-to-agent-wait-wake.e2e）：startApp({bootstrapStoneRepo:true})；造 parent thread do(intent, wait=true) fork child（用 root.do exec/submit 或直接 executeDoCommand）；`writeThread(parent)` + `writeThread(child)`；**`readThread(parent)` 全新加载**（模拟 worker reload）；断言 `restored.childThreads[childId]._parentThreadRef === restored`（D5 重建生效）；child 经 `deliverDoMessage(restored.childThreads[childId], parentId, "done", false)` 回报 → 断言 parent.inbox 增长（findThreadInScope 上行成功）。tier=Good。
- [ ] 运行（RED，未实装 D5 前应失败）：`RUN_BACKEND_E2E=1 NO_PROXY=localhost,127.0.0.1,::1 bun test tests/e2e/backend/do-parent-child-wait-wake.e2e.test.ts`。Expected: FAIL（_parentThreadRef undefined）。

### Task 2：deliverDoMessage 抽核 + readThread 重建（D3 核心 + D5）
- [ ] 新建 do/deliver.ts：deliverDoMessage（搬 executeDoWindowContinue 核心 + Critical 4 兜底）。
- [ ] command.continue.ts：executeDoWindowContinue 调 deliverDoMessage（行为不变；continueCommand/end.ts import 保留）。
- [ ] thread-json.ts readThread：重建 _parentThreadRef。
- [ ] 跑 Task1 e2e（GREEN）+ scheduler.test + do-thread-tree.test + do-*.integration（原样绿）+ commands-execution.test（end.result 路径绿）。

### Task 3：root.do_continue / do_close（D3 + D6）
- [ ] 新建 command.do-continue.ts / command.do-close.ts。
- [ ] root/index.ts ROOT_METHODS +2 + ROOT_KNOWLEDGE 表。
- [ ] commands.test.ts toEqual 加 do_continue/do_close + knowledge 断言。tsc + commands.test 绿。

### Task 4：render 过滤 do + 自视切片（D1 + D2）
- [ ] render.ts renderContextWindowsNode filter 加 do。
- [ ] self-view.ts renderActiveDoSlice + renderParentTaskSlice + 插入。
- [ ] 单测：有 running child 的 parent thread → `<self_view><active_children><child thread_id=...>`；child thread（有 creator do_window）→ `<parent_task>`；无→不渲。核对无 do_window 出现在 `<context_windows>`（render-skip 生效）+ do 消息不双渲（consumed 保留）。

### Task 5：wait.ts 迁移（D4）
- [ ] wait.ts do 候选 id→targetThreadId + handleWaitTool do-child 匹配 + 文案。
- [ ] wait.test.ts do 断言迁 childThreadId。

### Task 6：meta + 全回归
- [ ] meta/object.doc.ts do_window 节点（agent-facing 塌缩措辞，镜像 talk）+ method count。`bun tsc --noEmit meta/object.doc.ts`。
- [ ] 全回归：`bun tsc --noEmit`（0）+ `NO_PROXY=localhost,127.0.0.1,::1 bun test src/`（0 fail）+ `RUN_BACKEND_E2E=1 NO_PROXY=... bun test tests/e2e/backend/route-audit.e2e.test.ts tests/e2e/backend/do-parent-child-wait-wake.e2e.test.ts tests/e2e/backend/agent-to-agent-wait-wake.e2e.test.ts`（全绿——do 安全网 + talk 安全网 + 路由 gate）。

---

## 验证 gate
- [ ] agent 经 root.do_continue(target,msg,wait?) / do_close(target) 交互 child；do_window 不再出现在 `<context_windows>`；children 经 `<self_view><active_children>`、parent 任务经 `<parent_task>` 可见。
- [ ] **scheduler.test + do-thread-tree.test + do-*.integration + sharing.test 原样绿**（do_window 方法/share 全保留 → 证只塌缩 agent 面，未破并发/共享机制）。
- [ ] **do reload-crossing 安全网 e2e 绿**（readThread 重建 _parentThreadRef → child→parent 显式 reply 跨 reload 可用）。
- [ ] wait(on=<childThreadId>) 可等子线程；do 消息不双渲（consumed 保留）。
- [ ] bun test src/ 0 fail；tsc 0；meta tsc PASS；route-audit + talk 安全网 e2e 仍绿。
- [ ] continueCommand/renderDoWindow/filterMessagesForDoWindow/share_windows/DoWindow 类型**全保留**（L6c 才擦）。

---

## Feasibility review 消解表（NO-GO → 本 plan 处理）
| review 发现 | 处理 |
|---|---|
| **C1** end.ts:3 import continueCommand（被删则破） | **保留** continueCommand；抽 deliverDoMessage 共享，end.ts 不动（D3）|
| **C2** wait.ts listValidWaitTargets 按 do_window id（render-skip 后 agent 够不到）| do 候选迁 targetThreadId + handleWaitTool do-child 匹配（D4）|
| **C3** 删 filterMessagesForDoWindow → do 消息双渲（兜底+切片）| **保留** filterMessagesForDoWindow + collectWindowConsumedMessageIds do 分支；切片复用同逻辑（D1）|
| **C4** `_parentThreadRef` 不持久 → reload 后 child→parent reply 断 | readThread 重建（D5，persistable supplement 兑现 helpers.ts:52-53）+ deliverDoMessage 兜底 notify（D3）+ 安全网 e2e（Task1）|
| **H1** 删 share/move 破 sharing.test + plan-share-parent-child.e2e | share/move **全保留**作内部（agent 够不到即塌缩，L6c 擦）→ 零破坏 |
| **H2** do_continue/do_close 触发 commands.test 精确表 + knowledge 契约 | toEqual 加两项 + per-method knowledge ≥20（D6）|

## 残留开放点（执行中留意）
1. render-skip 是否波及现有「断言 do_window 出现在 `<context_windows>`」的测试（如 context.test / render 快照）——grep 确认并迁移（与 talk Phase C 同款波及面）。
2. renderActiveDoSlice 取 child status：用 `findChild(thread, targetThreadId)?.status`（同 thread.json 树内）；child 已 archived/paused（do_close 后）→ status!=="running" → 不在 active 列表（符合预期）。
3. deliverDoMessage 的 Critical 4 兜底仅 `target===parentThreadId` 触发；parent→child（向下 findChild）reload 安全（childThreads 持久），无需兜底。
