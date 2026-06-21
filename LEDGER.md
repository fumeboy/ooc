# 落地账本 —— thread-builtin-business-retreat

> 中间增量坏测试只登记、不逐步修；全部源码改完后统一修 + 跑绿（[[feedback_refactor_defer_test_fixes]]）。

## 增量进度

- [x] **E. unactive 改通知 + canceled 退役**（源码类型绿）
  - thread/index.ts：cancelSubtree 删 → unactive 改通知语义（non-terminal 发 inbox 系统通知、不切终态不级联；terminal 仅停用）。删 referencedObjectId/countSessionReferences dead import。TERMINAL={done,failed}。
  - _shared/types/thread.ts：ThreadStatus 删 "canceled"。
  - flows/model.ts：ListThreadsItem.status 删 "canceled"。
  - scheduler.ts:73-75 / worker.ts:299-304：去 canceled 比较（两函数整体在 B/substrate 退役，此处随 canceled 收敛）。
  - 待：清 canceled 注释（object-lifecycle.ts:8/21/67、close.ts:10、talk-fork.ts:6、session-methods.ts:10、readable/index.ts:97）；末尾加 canceled 进 check:deprecated-symbols FORBIDDEN_PATTERNS。
- [ ] **B. onChildTerminal 退潮**（scheduler emitChildEndNotifications → thread onChildTerminal policy + enqueueThread + 消费游标）
- [ ] **C-写侧. say inline status 删 + enqueue 唤醒归框架**
- [ ] **A. compress 退潮**（compress-fork/trigger policy → thread builtin + resolveCompressPolicy + thinkloop hook）

## 坏测试账本（末尾统一修）

- `builtins/agent/children/thread/__tests__/fork-unactive.test.ts`（51/82/83/102/106）：断言旧 cancelSubtree 行为（close fork 窗 → child canceled + 级联）。**改造**：close fork 窗 → child 收 inbox 系统通知「无订阅者」、status 仍 non-terminal（不 canceled）、不级联；waiting child 被唤醒。

## 落地后回流（对象树）

- self.md / index.md：core 10 unactive 通知语义 + canceled 退役；协调 lifecycle issue（landed）。
- check:deprecated-symbols 加 canceled 精确模式；check 规则豁免框架合法点。
