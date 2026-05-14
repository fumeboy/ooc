import { thread_v20260505_1 } from "@meta/object/thinkable/thread/index.doc";
import { object_v20260504_1 } from "@meta/object/index.doc";
import * as schedulerSource from "@src/thinkable/scheduler";

// doc 仅绑定实现源代码，不再绑定 .test.ts（避免顶层 import meta 时触发 bun:test 运行时）。
export const scheduler_v20260505_1 = {
  get parent() { return thread_v20260505_1; },
  sources: {
    scheduler: schedulerSource,
  },
  index: `
Scheduler 描述线程树的调度策略：每轮选哪个线程执行、何时唤醒等待中的线程、如何检测死锁。

## 基本循环

\`\`\`
while (有 running 线程) {
  先扫描 waiting 线程，优先处理 await_children 的唤醒
  再选一个 running 线程
    执行一轮 ThinkLoop
    若线程可持久化，则在 think 后立即 writeThread()
}
\`\`\`

## 选择策略：公平轮询

每次 tick 只调度**一个** running 线程执行一轮。

- 不严格深度优先：不会一直钻到最深叶子
- 不严格广度优先：不会要求兄弟全部跑完一轮
- 实际策略：按 lastExecutedAt 时间戳排序，最久未执行的优先
- 若 lastExecutedAt 相同，则按 thread id 打平手，保证选择稳定

理由：
- 避免单个线程独占资源
- 让深层子线程也能推进
- 保持兄弟线程协同

## 状态与调度的关系

| 状态 | 是否被调度 | 调度器行为 |
|---|---|---|
| running | 是 | 执行下一轮 ThinkLoop |
| waiting | 否 | 监测唤醒条件 |
| done    | 否 | 监测新 inbox 消息（有则翻回 running） |
| failed  | 否 | 同 done |
| paused | 否 | 等待人工 resume（详见 observable/pause） |

## 等待与唤醒（waiting → running）

线程通过 wait / do(wait=true) / do_window.continue(wait=true) 进入 waiting 状态。

Step 1（spec 2026-05-14）后 \`waitingType\` 字段已取消——所有”等待”语义统一为
“等 thread.inbox 出现新消息”，scheduler 仅看 \`status === “waiting”\`：

| 触发场景 | 实际唤醒路径 |
|---|---|
| do(wait=true) 等子线程完成 | scheduler 检测子线程 done/failed 后给父 inbox 写一条 system 消息 |
| 显式 wait | 任意新 inbox 消息 |
| 与 user 对话等待回复 | user reply 进 inbox |

线程入眠时由 wait tool 写入 \`thread.inboxSnapshotAtWait\`（当前 inbox 长度快照）；
scheduler 每 tick 比较 \`inbox.length > snapshot\` 即翻回 running 并清空 snapshot。

## done/failed 自动翻回 running

不需要 scheduler 主动检测。
任何写入 inbox 的路径，都会顺带检查目标线程状态：
若状态为 done，直接翻回 running 并通知调度器。

## 当前实现范围

当前源码实现并测试：
- 每个 tick 只执行一个 running thread
- running thread 按 lastExecutedAt 从小到大选择
- emitChildEndNotifications：子线程 done/failed 时给父 inbox 写一条 system 消息（幂等）
- wakeWaitingThreadsOnInbox：waiting 线程的 inbox 长度增长后翻回 running
- 若线程携带 persistable 引用，scheduler 在每轮 think 后保存线程状态

注入消息内容形如 \`[child:<childId>:<status>] <reason> - <summary>\`，
LLM 醒来后可直接读到子线程的最终状态与 summary。

这样父线程恢复后，下一轮 LLM 能直接看到“等待的子线程最后发生了什么”。

当前源码暂未实现：
- talk_sync / explicit_wait 的 inbox 唤醒
- 全局 deadlock 检测与强制唤醒
- super flow 调度
- 跨 object 调度与 talk 同步

## 死锁检测

定义：所有线程都进入 waiting 且没有可触发的唤醒条件 → 死锁。

典型场景：
- 父线程 talk(wait=true) 给子对象 X，X 又 talk(wait=true) 给父对象 → 互相等待
- 多个线程互相 wait 对方的子线程 → 环形等待

调度器的兜底：

\`\`\`
if 所有线程都 waiting 且无任何唤醒条件被满足:
  选最久未推进的线程
  强制翻转为 running
  在其 Context 中注入 <deadlock_notice>
  让 LLM 决定如何打破僵局
\`\`\`

## super flow

每个 Object 都有一个名为 super 的特殊 flow （stone/flow 形态哲学请见 meta/index.doc.js ）。
super 的线程树常驻，由独立的 SuperScheduler 调度。

详见 reflectable 文档。

# 特殊处理

user （系统人类用户）是特殊的 object, user 可以参与消息交互，但是 user 的 thread 不由系统调度执行
`,
  object: object_v20260504_1,
};
