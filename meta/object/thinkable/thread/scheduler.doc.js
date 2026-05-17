import { thread_v20260505_1 } from "@meta/object/thinkable/thread/index.doc";
import * as schedulerSource from "@src/thinkable/scheduler";
import * as jobManagerSource from "@src/app/server/runtime/job-manager";
import * as pauseStoreSource from "@src/app/server/runtime/pause-store";
import * as resumeSource from "@src/app/server/runtime/resume";
import * as threadQuerySource from "@src/app/server/runtime/thread-query";
import * as threadTransitionSource from "@src/app/server/runtime/thread-transition";
import * as workerSource from "@src/app/server/runtime/worker";

/**
 * Scheduler 概念：单 thread 树的调度策略 + 服务化外壳（worker / job manager / pause）。
 *
 * sources:
 *  - scheduler         — 进程内 tick 循环（公平选 thread / 唤醒 / 子线程通知）
 *  - jobManager        — HTTP 入口产生的 run-thread / resume-thread job 队列
 *  - pauseStore        — 全局 / 单 session pause 状态
 *  - resume            — paused → running 状态翻转策略
 *  - threadQuery       — 持久化 thread 扫描（paused 集合等）
 *  - threadTransition  — 状态规则下沉（被 service 调用，避免分散）
 *  - worker            — 后台 polling 把 scheduler 服务化
 */
export const scheduler_v20260505_1 = {
  name: "Scheduler",
  get parent() { return thread_v20260505_1; },
  sources: {
    scheduler: schedulerSource,
    jobManager: jobManagerSource,
    pauseStore: pauseStoreSource,
    resume: resumeSource,
    threadQuery: threadQuerySource,
    threadTransition: threadTransitionSource,
    worker: workerSource,
  },
  description: `
Scheduler 描述线程树的调度策略：每轮选哪个线程执行、何时唤醒等待中的线程、如何检测死锁。
服务化外壳（worker / jobManager / pauseStore / resume / threadQuery / threadTransition）
负责把进程内单 tick 循环延伸成长跑后台服务，详见各子字段。

## 基本循环

\`\`\`
while (有 running 线程) {
  先扫描 waiting 线程，优先处理因子线程 end / inbox 增长唤醒
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
| paused  | 否 | 等待人工 resume（详见 observable/pause） |

## 等待与唤醒（waiting → running）

线程通过 wait / do(wait=true) / do_window.continue(wait=true) 进入 waiting 状态。
\`wait\` 原语要求显式 \`on=<window_id>\` 指向 talk_window 或 do_window（详见
executable.concepts），无合法 on 时 wait 被 reject。

唤醒条件统一为"thread.inbox 出现新消息"，scheduler 仅看 \`status === "waiting"\`：

| 触发场景 | 实际唤醒路径 |
|---|---|
| do(wait=true) 等子线程完成 | scheduler 检测子线程 done/failed 后给父 inbox 写一条 system 消息 |
| 显式 wait | 任意新 inbox 消息 |
| 与 user 对话等待回复 | user reply 进 inbox |

线程入眠时由 wait tool 写入 \`thread.inboxSnapshotAtWait\`（当前 inbox 长度快照）+
\`thread.waitingOn\`（IO 来源 window id，observability）；scheduler 每 tick 比较
\`inbox.length > snapshot\` 即翻回 running 并清空两个字段。

## done/failed 自动翻回 running

不需要 scheduler 主动检测。任何写入 inbox 的路径都会顺带检查目标线程状态：
若状态为 done，直接翻回 running 并通知调度器。

## 子线程结束通知

子线程 status 变为 done/failed 时，scheduler emitChildEndNotifications 给父
inbox 写一条 system 消息 \`[child:<childId>:<status>@<lastExecutedAt>] <reason> - <summary>\`。
marker 含 lastExecutedAt 区分 child 的多次 end（do_window.continue 触发 child
done→running→done 时第二次 end 也能产生新 marker，避免父线程死锁）。

## 服务化外壳

- **jobManager**：HTTP 入口（POST /api/flows/:sid/continue 等）把"调度某 thread"
  转成 job 入队；worker 消费 job 调度对应 thread
- **pauseStore**：全局 / 单 session pause 标记；scheduler 通过 setPauseChecker
  注入 hook，进入 think 前检查是否暂停
- **resume**：paused → running 转换策略；resumeSession 时由 service 调用
- **threadQuery**：扫描持久化目录找出 paused thread 集合（控制平面用）
- **threadTransition**：把状态规则从 service 层下沉的 helper，避免 status="running"
  在多处手写

## 死锁检测

定义：所有线程都进入 waiting 且没有可触发的唤醒条件 → 死锁。

典型场景：
- 父线程 talk(wait=true) 给子对象 X，X 又 talk(wait=true) 给父对象 → 互相等待
- 多个线程互相 wait 对方的子线程 → 环形等待

调度器的兜底（设计层面，暂未实现）：

\`\`\`
if 所有线程都 waiting 且无任何唤醒条件被满足:
  选最久未推进的线程
  强制翻转为 running
  在其 Context 中注入 <deadlock_notice>
  让 LLM 决定如何打破僵局
\`\`\`

## super flow

每个 Object 都有一个名为 super 的特殊 flow （stone/flow 形态哲学请见 meta/index.doc.js）。
super 的线程树常驻，由独立的 SuperScheduler 调度。

详见 reflectable 文档。

# 特殊处理

user（系统人类用户）是特殊的 object，user 可以参与消息交互，但是 user 的 thread
不由系统调度执行。
`.trim(),
};
