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

线程通过 wait / do(wait=true) / talk(wait=true) 进入 waiting 状态。
节点上记录 waitingType 标识等待原因：

| waitingType | 含义 | 唤醒条件 |
|---|---|---|
| await_children | 等待某个/某些子线程完成 | 对应子线程进入 done |
| talk_sync      | talk(wait=true) 等待对方回复 | 对方 talk 回到本线程 inbox |
| explicit_wait  | LLM 主动 wait（等任何 inbox 消息） | 任意新 inbox 消息 |

## done/failed 自动翻回 running

不需要 scheduler 主动检测。
任何写入 inbox 的路径，都会顺带检查目标线程状态：
若状态为 done，直接翻回 running 并通知调度器。

## 当前实现范围

当前源码实现并测试：
- 每个 tick 只执行一个 running thread
- running thread 按 lastExecutedAt 从小到大选择
- waitingType=await_children 的父线程在子线程 done/failed 后恢复 running
- 若线程携带 persistable 引用，scheduler 在每轮 think 后保存线程状态

await_children 被唤醒时，当前实现还会向父线程注入一段总结：

- 每个等待中的子线程都会生成一行摘要
- 摘要优先使用 \`endReason / endSummary\`
- 若缺少 summary，则回退到子线程 status 或“无 summary”

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
