import { thread_v20260505_1 } from "@meta/object/thinkable/thread/index.doc";
import * as scheduler from "@src/thinkable/scheduler";
import * as jobManager from "@src/app/server/runtime/job-manager";
import * as pauseStore from "@src/app/server/runtime/pause-store";
import * as resume from "@src/app/server/runtime/resume";
import * as threadQuery from "@src/app/server/runtime/thread-query";
import * as threadTransition from "@src/app/server/runtime/thread-transition";
import * as worker from "@src/app/server/runtime/worker";

/**
 * Scheduler 概念：thread 树的调度策略 + 服务化外壳。
 *
 * sources:
 *  - scheduler         — 进程内 tick 循环（公平选 thread / 唤醒 / 子线程通知）
 *  - jobManager        — HTTP 入口产生的 run-thread / resume-thread job 队列
 *  - pauseStore        — 全局 / 单 session pause 状态
 *  - resume            — paused → running 状态翻转策略
 *  - threadQuery       — 持久化 thread 扫描（paused 集合等）
 *  - threadTransition  — 状态规则下沉的 helper
 *  - worker            — 后台 polling 把 scheduler 服务化
 */
export const scheduler_v20260505_1 = {
  name: "Scheduler",
  get parent() { return thread_v20260505_1; },
  sources: {
    scheduler,
    jobManager,
    pauseStore,
    resume,
    threadQuery,
    threadTransition,
    worker,
  },
  description: `
Scheduler 描述线程树的调度策略：每轮选哪个线程执行、何时唤醒等待中的线程、
死锁如何打破。服务化外壳把进程内单 tick 循环延伸成长跑后台服务。

按子字段展开：

- loop — 基本 tick 循环
- selection — 公平轮询选择策略
- stateTable — 各 status 是否被调度
- wakeup — waiting → running 的唤醒规则
- childEndNotification — 子线程结束如何通知父
- serviceShell — worker / jobManager / pauseStore / resume / threadQuery / threadTransition
- deadlock — 死锁检测兜底（设计层面）
- superFlow — super flow 的独立调度通道
- userException — user object 不被系统调度
`.trim(),

  loop_v20260505_1: {
    index: `
## 基本循环

\`\`\`
while (有 running 线程) {
  先扫描 waiting 线程，处理因子线程 end / inbox 增长的唤醒
  再选一个 running 线程
    执行一轮 ThinkLoop
    若线程可持久化，则 think 后立即 writeThread()
}
\`\`\`

scheduler 每 tick 只执行一轮 ThinkLoop。tick 由进程内 runScheduler 驱动
（integration 测试场景），或由 worker 在生产服务中按 \`workerPollMs\` 间隔轮询触发。
`.trim(),
  },

  selection_v20260505_1: {
    index: `
## 选择策略：公平轮询

每次 tick 只调度**一个** running 线程执行一轮。

- 不严格深度优先：不会一直钻到最深叶子
- 不严格广度优先：不会要求兄弟全部跑完一轮
- 实际策略：按 lastExecutedAt 时间戳排序，最久未执行的优先
- 若 lastExecutedAt 相同，则按 thread id 字典序打平手，保证选择稳定

理由：

- 避免单个线程独占资源
- 让深层子线程也能推进
- 保持兄弟线程协同
`.trim(),
  },

  stateTable_v20260505_1: {
    index: `
## 状态与调度的关系

| status | 是否被调度 | 调度器行为 |
|---|---|---|
| running | 是 | 执行下一轮 ThinkLoop |
| waiting | 否 | 监测唤醒条件（inbox 长度增长） |
| done    | 否 | 监测新 inbox 消息（有则翻回 running） |
| failed  | 否 | 同 done |
| paused  | 否 | 等待人工 resume（详见 \`observable.pause\`） |
`.trim(),
  },

  wakeup_v20260505_1: {
    index: `
## 等待与唤醒（waiting → running）

线程通过 \`wait\` / \`do(wait=true)\` / \`do_window.continue(wait=true)\` /
\`talk(wait=true)\` / \`talk_window.say(wait=true)\` 进入 waiting 状态。

\`wait\` 原语要求显式 \`on=<window_id>\` 指向 talk_window 或 do_window
（详见 \`executable.actions.tools.wait\`），无合法 on 时 wait 被 reject。

入眠时由 wait tool / window-level wait 写入：

- \`thread.inboxSnapshotAtWait\` — 当前 inbox 长度快照（wakeup 决策依据）
- \`thread.waitingOn\` — IO 来源 window id（observability，不参与 wakeup 决策）

唤醒规则：scheduler 每 tick 比较 \`inbox.length > snapshot\` 即翻回 running 并
清空两个字段。

唤醒源类型：

| 触发场景 | 实际写 inbox 的路径 |
|---|---|
| do(wait=true) 等子线程完成 | scheduler.emitChildEndNotifications 写 system 消息 |
| 显式 wait | 任意新 inbox 消息（含子线程、talk、控制面 inject） |
| talk 等回信 | 对端通过 talk-delivery 写本端 inbox |
`.trim(),
  },

  childEndNotification_v20260505_1: {
    index: `
## 子线程结束通知

子线程 status 变为 done/failed 时，scheduler emitChildEndNotifications 给父
inbox 写一条 system 消息：

\`\`\`
[child:<childId>:<status>@<lastExecutedAt>] <reason> - <summary>
\`\`\`

marker 含 \`lastExecutedAt\` 区分 child 的多次 end —— do_window.continue 触发
child done→running→done 时第二次 end 也能产生新 marker，避免父线程死锁。

幂等：同 marker 不会写第二次。父线程恢复后能直接从 inbox 这条 system 消息读到
子线程的最终 status / reason / summary。
`.trim(),
  },

  serviceShell_v20260505_1: {
    index: `
## 服务化外壳

| 模块 | 职责 |
|---|---|
| jobManager | HTTP 入口产生的 run-thread / resume-thread job 队列；worker 消费 |
| worker | 后台 polling 把 scheduler 服务化；按 \`workerPollMs\` 间隔轮询 job 队列 |
| pauseStore | 全局 / 单 session pause 标记；scheduler 通过 setPauseChecker 注入 hook，进入 think 前检查 |
| resume | paused → running 转换策略；resumeSession 时由 service 调用 |
| threadQuery | 扫描持久化目录找出 paused thread 集合（控制平面用） |
| threadTransition | 状态规则下沉的 helper（被 service 调用，避免 \`status="running"\` 在多处手写） |

服务化分层让进程内 scheduler 不知道 HTTP / 持久化 / pause 概念；它只看 thread tree
内存对象。job 队列 + pause hook 把这些外部概念以"扩展点"形式注入。
`.trim(),
  },

  deadlock_v20260505_1: {
    index: `
## 死锁检测（设计层面）

定义：所有线程都进入 waiting 且没有可触发的唤醒条件 → 死锁。

典型场景：

- 父 talk(wait=true) → 子，子 talk(wait=true) → 父 → 互相等待
- 多线程互相 wait 对方的子线程 → 环形等待

调度器兜底（暂未实现，仅设计层面记录）：

\`\`\`
if 所有线程都 waiting 且无任何唤醒条件被满足:
  选最久未推进的线程
  强制翻转为 running
  在其 Context 中注入 <deadlock_notice>
  让 LLM 决定如何打破僵局
\`\`\`
`.trim(),
  },

  superFlow_v20260505_1: {
    index: `
## super flow 的独立调度通道

每个 Object 都有一个名为 super 的特殊 flow。super 的线程树常驻，由独立的
SuperScheduler 调度（与普通 flow 的 scheduler 隔离）。

super 通道承载 Object 的自我反思 / 长期记忆更新 / server method 注册等元编程
能力。详见 \`reflectable\`。
`.trim(),
  },

  userException_v20260505_1: {
    index: `
## user object 的调度例外

user 是系统人类用户对应的特殊 Object：

- user 可以参与消息交互（user.root 持有 talk_window 派送消息到其它 Object）
- 但 user 的 thread **不由系统调度执行**——worker 跳过 \`thread.persistence.objectId === "user"\` 的 thread
- 控制面（HTTP API）直接代用户产生消息，等价于 user thread 上 LLM 调了 talk_window.say

详见 collaborable 文档与 \`@src/app/server/modules/flows/service\` 中的
\`USER_OBJECT_ID\` 处理路径。
`.trim(),
  },
};
