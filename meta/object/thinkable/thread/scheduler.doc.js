import { thread_v20260505_1 } from "@meta/object/thinkable/thread/index.doc";

export const scheduler_v20260505_1 = {
    parent: thread_v20260505_1,
    index: `
Scheduler 描述线程树的调度策略：每轮选哪个线程执行、何时唤醒等待中的线程、如何检测死锁。

## 基本循环

\`\`\`
while (有 running 线程) {
  选一个 running 线程
    执行一轮 ThinkLoop
  扫描 waiting 线程，检查是否可唤醒
  扫描 done 线程，若有新 inbox 消息则翻回 running
  检测死锁
}
\`\`\`

## 选择策略：公平轮询

每次 tick 只调度**一个** running 线程执行一轮。

- 不严格深度优先：不会一直钻到最深叶子
- 不严格广度优先：不会要求兄弟全部跑完一轮
- 实际策略：按 lastExecutedAt 时间戳排序，最久未执行的优先

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
| failed  | 否 | 不再调度 |
| pausing/paused | 否 | 等待人工 resume（详见 observable/pause） |

## 等待与唤醒（waiting → running）

线程通过 wait / do(wait=true) / talk(wait=true) 进入 waiting 状态。
节点上记录 waitingType 标识等待原因：

| waitingType | 含义 | 唤醒条件 |
|---|---|---|
| await_children | 等待某个/某些子线程完成 | 对应子线程进入 done |
| talk_sync      | talk(wait=true) 等待对方回复 | 对方 talk 回到本线程 inbox |
| explicit_wait  | LLM 主动 wait（等任何 inbox 消息） | 任意新 inbox 消息 |

调度器扫描逻辑：

\`\`\`
for each waiting thread:
  switch waitingType:
    case "await_children":
      if 等待的子线程都 done:
        thread.status = running
    case "talk_sync":
      if inbox 收到对方回复:
        thread.status = running
    case "explicit_wait":
      if inbox.unread.length > 0:
        thread.status = running
\`\`\`

## done 自动翻回 running

不需要 scheduler 主动检测。
任何写入 inbox 的路径，都会顺带检查目标线程状态：
若状态为 done，直接翻回 running 并通知调度器。

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

## 终止条件

- 单 Object：根线程 status ∈ {done, failed} 且无新 inbox 消息进入
- 单 Session：所有 Object 的根线程都终止 + 用户未追加新消息 → Session 进入 idle
- Session 终止：用户显式终止或长时间无活动 → 清理所有 Flow 标记

## 跨 Session 的特殊调度（super 分身）

每个 Object 都有一个名为 super 的反思镜像分身。
super 的线程树跨所有 session 常驻，由独立的 SuperScheduler 调度。

详见 reflectable/super-flow。

## 与认知/协作的边界

本文档关注"读侧"：调度器从认知角度如何选择线程执行。

调度的"写侧"——具体的死锁检测算法、跨对象消息路由、Session 生命周期管理——
归属 collaborable 维度。
`,
};
