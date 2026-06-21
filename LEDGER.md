# 落地账本 —— thread-builtin-business-retreat

> 中间增量坏测试只登记、不逐步修；全部源码改完后统一修 + 跑绿（[[feedback_refactor_defer_test_fixes]]）。

## 增量进度

- [x] **E. unactive 改通知 + canceled 退役 —— 完成（commit 8199afe2，check:tsc 绿 / thread+lifecycle 64 pass）**
  - thread/index.ts：cancelSubtree 删 → unactive 改通知语义（non-terminal 发 inbox 系统通知「无消息订阅者」、不切终态不级联；terminal 仅停用）。删 referencedObjectId/countSessionReferences dead import。TERMINAL={done,failed}。
  - _shared/types/thread.ts + flows/model.ts：ThreadStatus / ListThreadsItem.status 删 "canceled"。
  - scheduler.ts / worker.ts：去 canceled 比较（两函数整体在 B/substrate 退役，此处随终态集收敛）。
  - canceled 注释全清（close/talk-fork/session-methods/readable/object-lifecycle）。
  - **不加 canceled 进 FORBIDDEN_PATTERNS**（词太通用易长期误报；靠 ThreadStatus 类型防回归——实现期裁决，回流时在 issue 注明）。
  - fork-unactive.test 重写为通知行为（3 pass）；object-lifecycle.test fixture canceled→done。

### 续作计划（B / C-写侧 / A —— 共享 enqueueThread + scheduler/thread 文件，须顺序做、勿并行）

- [ ] **B. onChildTerminal 退潮**
  1. 新建 `enqueueThread`（runtime）：泛化 `core/observable/index.ts:53 notifyThreadActivated`（同 session 内存唤醒 / 跨 session 持久调度信号 + 终态复活 waiting/done/failed→running）。
  2. 新 OocClass 槽 `onChildTerminal?`（ooc-class.ts）+ registry `resolveOnChildTerminal`（object-registry.ts，同 active/unactive 模式，**同步 register/seedFrom 两处 merge**）。
  3. scheduler 删 `emitChildEndNotifications`（+ iterateThreads/makeSystemMessage 若仅它用）；改为检测 child→终态、派发 thread.onChildTerminal policy（调度 creator + 重投影，零 marker 副本）。
  4. thread onChildTerminal policy：fork 子终态 → enqueueThread(creator)；**瘦身持久消费游标**（per (creator,child,tail) 去重，防 level-triggered busy-loop / do_window.continue 二次终态）。
  5. 账本登记受影响测试。
- [ ] **C-写侧. say inline status 删 + 唤醒归框架**
  - 删 talk-delivery.ts:206-210 + session-methods.ts:104-109 的 inline 写 peer.status；唤醒经 enqueueThread（依赖 B 的 enqueueThread + 终态复活）。:101-102 fork 派送本体保留。
  - **不删 caller outbox 镜像**（读侧原子对，归 substrate issue）。
- [ ] **A. compress 退潮**（最大块）
  - resolveCompressPolicy 槽；compress-fork/compress-trigger 的 policy（触发/spawn/seed/harvest/force-wait 意图）迁 thread builtin；core 留 budget/WindowManager.instantiate/isSummarizer 执行/snapRangesToToolPairs/projectSummarizedRanges；thinkloop hook 改派发 thread policy；CompressV2Win→ThreadWin；scheduler 删 harvestSummarizerForks。
  - 保 real-compress-v2 e2e（orphan/force-wait floor 不丢）。
- [ ] **统一收尾**：check 规则扫 scheduler.ts + context/compress-*（豁免框架合法点 endSummary@thinkloop:442 / isSelfThreadWindow@index.ts:433）；`bun run verify` 全绿；删 LEDGER.md + node_modules 符号链接勿入 commit（git add 用显式路径，勿 -A）。
- [ ] **B. onChildTerminal 退潮**（scheduler emitChildEndNotifications → thread onChildTerminal policy + enqueueThread + 消费游标）
- [ ] **C-写侧. say inline status 删 + enqueue 唤醒归框架**
- [ ] **A. compress 退潮**（compress-fork/trigger policy → thread builtin + resolveCompressPolicy + thinkloop hook）

## 坏测试账本（末尾统一修）

- `builtins/agent/children/thread/__tests__/fork-unactive.test.ts`（51/82/83/102/106）：断言旧 cancelSubtree 行为（close fork 窗 → child canceled + 级联）。**改造**：close fork 窗 → child 收 inbox 系统通知「无订阅者」、status 仍 non-terminal（不 canceled）、不级联；waiting child 被唤醒。

## 落地后回流（对象树）

- self.md / index.md：core 10 unactive 通知语义 + canceled 退役；协调 lifecycle issue（landed）。
- check:deprecated-symbols 加 canceled 精确模式；check 规则豁免框架合法点。
