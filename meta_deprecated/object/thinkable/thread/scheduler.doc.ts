import type { Concept, DocNode, ExampleNode, InvariantNode } from "@meta/doc-types";
import { thread_v20260505_1 } from "@meta/object/thinkable/thread/index.doc";
import * as scheduler from "@src/thinkable/scheduler";
import * as jobManager from "@src/app/server/runtime/job-manager";
import * as pauseStore from "@src/app/server/runtime/pause-store";
import * as resume from "@src/app/server/runtime/resume";
import * as threadQuery from "@src/app/server/runtime/thread-query";
import * as threadTransition from "@src/app/server/runtime/thread-transition";
import * as worker from "@src/app/server/runtime/worker";
import * as flowsService from "@src/app/server/modules/flows/service";

/* ────────────────────────────────────────────────────────────────
 *  目录页：Scheduler 概念骨架
 * ──────────────────────────────────────────────────────────────── */

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
 *  - flowsService      — HTTP 控制面：USER_OBJECT_ID / talk-delivery / user-reply 入口
 */
export type SchedulerConcept = Concept & {
  sources: {
    scheduler: typeof scheduler;
    jobManager: typeof jobManager;
    pauseStore: typeof pauseStore;
    resume: typeof resume;
    threadQuery: typeof threadQuery;
    threadTransition: typeof threadTransition;
    worker: typeof worker;
    flowsService: typeof flowsService;
  };

  /** 基本 tick 循环 */
  loop: {
    title: string;
    summary?: string;
    pseudocode: ExampleNode;
    /** 每 tick 只跑一轮 */
    tickGranularity: InvariantNode;
    tickDriver: DocNode;
    /** think 后立即 writeThread */
    writeAfterThink: InvariantNode;
  };

  /** 公平轮询选择策略 */
  selection: {
    title: string;
    summary?: string;
    onePerTick: DocNode;
    notStrictDFS: DocNode;
    notStrictBFS: DocNode;
    lastExecutedAtOrdering: DocNode;
    /** tie-break 按 thread id 字典序 */
    tieBreakStable: InvariantNode;
    rationale: DocNode;
  };

  /** 各 status 是否被调度的表 */
  stateTable: DocNode;

  /** waiting → running 的唤醒规则 */
  wakeup: {
    title: string;
    summary?: string;
    waitTriggerPrimitives: DocNode;
    /** wait 必须显式 on=<window_id> */
    waitOnMandatory: InvariantNode;
    waitSnapshotField: DocNode;
    waitingOnField: DocNode;
    /** inbox 长度 > snapshot 即唤醒 */
    wakeupConditionInboxGrowth: InvariantNode;
    /** 唤醒时清空两个字段 */
    wakeupCleanupTwoFields: InvariantNode;
    wakeupSources: DocNode;
  };

  /** 子线程结束如何通知父 */
  childEndNotification: {
    title: string;
    summary?: string;
    markerFormat: ExampleNode;
    markerLastExecutedAt: DocNode;
    /** 幂等：同 marker 不写第二次 */
    idempotent: InvariantNode;
    parentReadSemantics: DocNode;
  };

  /** worker / jobManager / pauseStore / resume / threadQuery / threadTransition */
  serviceShell: {
    title: string;
    summary?: string;
    moduleTable: DocNode;
    /** scheduler 通过 setPauseChecker 注入 hook */
    pauseCheckerInjection: InvariantNode;
    /** scheduler 不知道 HTTP / 持久化 / pause 概念 */
    layeringSeparation: InvariantNode;
  };

  /** 死锁检测（设计层面） */
  deadlock: {
    title: string;
    summary?: string;
    definition: DocNode;
    typicalScenarios: DocNode;
    fallbackDesign: ExampleNode;
    /** 当前未实现 */
    notYetImplemented: InvariantNode;
  };

  /** super flow 的独立调度通道 */
  superFlow: {
    title: string;
    summary?: string;
    persistentThreadTree: DocNode;
    /** SuperScheduler 与普通 scheduler 隔离 */
    independentScheduler: InvariantNode;
    superCapabilities: DocNode;
  };

  /** user object 不被系统调度 */
  userException: {
    title: string;
    summary?: string;
    userObjectDefinition: DocNode;
    userCanMessage: DocNode;
    /** user 的 thread 不被系统调度 */
    userNotScheduled: InvariantNode;
    controlPlaneAsUserDriver: DocNode;
  };
};

/* ────────────────────────────────────────────────────────────────
 *  数据填充
 * ──────────────────────────────────────────────────────────────── */

export const scheduler_v20260505_1: SchedulerConcept = {
  name: "Scheduler",
  get parent() {
    return thread_v20260505_1;
  },
  sources: {
    scheduler,
    jobManager,
    pauseStore,
    resume,
    threadQuery,
    threadTransition,
    worker,
    flowsService,
  },
  description: `
Scheduler 描述线程树的调度策略：每轮选哪个线程执行、何时唤醒等待中的线程、
死锁如何打破。服务化外壳把进程内单 tick 循环延伸成长跑后台服务。
`.trim(),

  loop: {
    title: "基本循环",
    summary: "tick 粒度 + 立即落盘",

    pseudocode: {
      kind: "example",
      title: "伪代码",
      content: `
\`\`\`
while (有 running 线程) {
  先扫描 waiting 线程，处理因子线程 end / inbox 增长的唤醒
  再选一个 running 线程
    执行一轮 ThinkLoop
    若线程可持久化，则 think 后立即 writeThread()
}
\`\`\`
      `.trim(),
    },

    tickGranularity: {
      kind: "invariant",
      title: "每 tick 只跑一轮",
      summary: "tick 是公平调度单位，单线程不能在一 tick 内连跑多轮",
      content: "scheduler 每 tick 只执行**一轮** ThinkLoop。",
      rationale: "让 tick 成为公平调度单位——避免某线程在一个 tick 内连跑多轮独占资源。",
    },

    tickDriver: {
      title: "tick 驱动来源",
      content: `
tick 由进程内 runScheduler 驱动（integration 测试场景），或由 worker 在生产服务中
按 workerPollMs 间隔轮询触发。

让同一份 scheduler 实现既能本地批量跑（测试），又能服务化后台跑（生产）。
      `.trim(),
    },

    writeAfterThink: {
      kind: "invariant",
      title: "think 后立即 writeThread",
      summary: "可持久化线程 think 完成后立即 writeThread()，不延迟批量写",
      content:
        "可持久化线程在 think 完成后立即 writeThread()，不延迟批量写。",
      rationale:
        "保证 crash safety——任何一轮 think 的事件流必须落盘后才被视为「已发生」，否则崩溃恢复时线程状态会回滚。",
    },
  },

  selection: {
    title: "选择策略：公平轮询",
    summary: "lastExecutedAt 升序 + thread id 字典序 tie-break",

    onePerTick: {
      title: "每次 tick 只调度一个",
      content: "每次 tick 只调度一个 running 线程执行一轮。",
    },

    notStrictDFS: {
      title: "不严格深度优先",
      content: "不会一直钻到最深叶子（避免某个深叶子线程独占调度）。",
    },

    notStrictBFS: {
      title: "不严格广度优先",
      content: "不会要求兄弟全部跑完一轮（让深层子线程也能推进）。",
    },

    lastExecutedAtOrdering: {
      title: "实际策略：lastExecutedAt 升序",
      content: "按 lastExecutedAt 时间戳排序，最久未执行的优先。",
    },

    tieBreakStable: {
      kind: "invariant",
      title: "lastExecutedAt 平手时按 thread id 字典序",
      summary: "保证选择稳定，让 snapshot 测试可复现",
      content: "若 lastExecutedAt 相同，则按 thread id 字典序打平手，保证选择稳定。",
      rationale:
        "让 snapshot 测试可复现，且避免随机抖动导致难追踪的「为什么这次跑了别的线程」。",
    },

    rationale: {
      title: "选择策略的理由",
      content: `
- 避免单个线程独占资源
- 让深层子线程也能推进
- 保持兄弟线程协同
      `.trim(),
    },
  },

  stateTable: {
    title: "状态与调度的关系",
    summary: "running 入选；waiting/done/failed/paused 各自唤醒条件",
    content: `
| status | 是否被调度 | 调度器行为 |
|---|---|---|
| running | 是 | 执行下一轮 ThinkLoop |
| waiting | 否 | 监测唤醒条件（inbox 长度增长） |
| done    | 否 | 监测新 inbox 消息（有则翻回 running） |
| failed  | 否 | 同 done |
| paused  | 否 | 等待人工 resume（详见 observable.pause） |
    `.trim(),
  },

  wakeup: {
    title: "等待与唤醒（waiting → running）",
    summary: "wait 原语 → inboxSnapshotAtWait → inbox 增长触发翻转",

    waitTriggerPrimitives: {
      title: "入眠触发原语",
      content: `
线程通过以下原语进入 waiting 状态：

- wait
- do(wait=true)
- do_window.continue(wait=true)
- talk(wait=true)
- talk_window.say(wait=true)
      `.trim(),
    },

    waitOnMandatory: {
      kind: "invariant",
      title: "wait 必须显式 on=<window_id>",
      summary: "无合法 on 时 wait 被 reject",
      content:
        "wait 原语要求显式 `on=<window_id>` 指向 talk_window 或 do_window，无合法 on 时 wait 被 reject。",
      rationale:
        "没有指向的 wait 是死循环温床——必须明确「等谁」，让 scheduler 能识别唤醒来源、让 observability 能展示「this thread is waiting on which window」。",
    },

    waitSnapshotField: {
      title: "inboxSnapshotAtWait 字段",
      content: `
入眠时由 wait tool / window-level wait 写入：
\`thread.inboxSnapshotAtWait\` — 当前 inbox 长度快照（wakeup 决策依据）。
      `.trim(),
    },

    waitingOnField: {
      title: "waitingOn 字段",
      content: `
入眠时同时写入：\`thread.waitingOn\` — IO 来源 window id。

仅作 observability 用，**不**参与 wakeup 决策（决策只看 inbox 长度变化）。
      `.trim(),
    },

    wakeupConditionInboxGrowth: {
      kind: "invariant",
      title: "唤醒条件 = inbox 长度 > snapshot",
      summary: "用长度增长而非消息匹配做判定，最简单且不漏唤",
      content:
        "scheduler 每 tick 比较 `inbox.length > snapshot` 即翻回 running 并清空两个字段。",
      rationale:
        "任何新消息（无论来源）都会让线程苏醒，由 LLM 自行判断是否相关——比起按 source 过滤更不容易漏唤。",
    },

    wakeupCleanupTwoFields: {
      kind: "invariant",
      title: "唤醒时清空 inboxSnapshotAtWait + waitingOn",
      summary: "防止下次入眠基于旧快照错误判定",
      content: "唤醒发生时 inboxSnapshotAtWait 与 waitingOn 都被清空。",
      rationale: "防止下次入眠基于旧快照错误判定（旧 snapshot < 新 inbox 长度，立即假唤醒）。",
    },

    wakeupSources: {
      title: "唤醒源类型",
      content: `
| 触发场景 | 实际写 inbox 的路径 |
|---|---|
| do(wait=true) 等子线程完成 | scheduler.emitChildEndNotifications 写 system 消息 |
| 显式 wait | 任意新 inbox 消息（含子线程、talk、控制面 inject） |
| talk 等回信 | 对端通过 talk-delivery 写本端 inbox |
      `.trim(),
    },
  },

  childEndNotification: {
    title: "子线程结束通知",
    summary: "system 消息 marker 含 lastExecutedAt 区分多次 end",

    markerFormat: {
      kind: "example",
      title: "marker 格式",
      content: `
子线程 status 变为 done/failed 时，scheduler emitChildEndNotifications 给父
inbox 写一条 system 消息：

\`\`\`
[child:<childId>:<status>@<lastExecutedAt>] <reason> - <summary>
\`\`\`
      `.trim(),
    },

    markerLastExecutedAt: {
      title: "lastExecutedAt 区分多次 end",
      content: `
marker 含 lastExecutedAt 区分 child 的多次 end —— do_window.continue 触发
child done→running→done 时第二次 end 也能产生新 marker，**避免父线程死锁**。

设计原因：如果 marker 只用 childId，那么 continue 重启后再 end 写第二条 marker
会被去重视作「同一事件」丢弃，父因此永远等不到第二次完成的通知。
      `.trim(),
    },

    idempotent: {
      kind: "invariant",
      title: "同 marker 不写第二次",
      summary: "(childId + status + lastExecutedAt) 三元组只写一次",
      content:
        "相同 (childId + status + lastExecutedAt) 三元组只写一次；scheduler 重复触发 emitChildEndNotifications 不会让父 inbox 出现重复消息。",
      rationale:
        "幂等保证 scheduler 可重入；同时让 lastExecutedAt 这个第三维严格承担「区分多次 end」的语义。",
    },

    parentReadSemantics: {
      title: "父线程读取语义",
      content: `
父线程恢复后能直接从 inbox 这条 system 消息读到子线程的最终 status / reason / summary，
**不需要**额外的 child-state lookup API。

设计原因：保持「线程间通信只走 inbox」这条不变量，子线程结束语义不破例。
      `.trim(),
    },
  },

  serviceShell: {
    title: "服务化外壳",
    summary: "worker / jobManager / pauseStore / resume / threadQuery / threadTransition",

    moduleTable: {
      title: "模块表",
      content: `
| 模块 | 职责 |
|---|---|
| jobManager | HTTP 入口产生的 run-thread / resume-thread job 队列；worker 消费 |
| worker | 后台 polling 把 scheduler 服务化；按 workerPollMs 间隔轮询 job 队列 |
| pauseStore | 全局 / 单 session pause 标记 |
| resume | paused → running 转换策略；resumeSession 时由 service 调用 |
| threadQuery | 扫描持久化目录找出 paused thread 集合（控制平面用） |
| threadTransition | 状态规则下沉的 helper（被 service 调用，避免 status="running" 在多处手写） |
      `.trim(),
    },

    pauseCheckerInjection: {
      kind: "invariant",
      title: "scheduler 通过 setPauseChecker 注入 hook",
      summary: "pauseStore 不被 scheduler 直接 import",
      content:
        "pauseStore 不被 scheduler 直接 import；scheduler 通过 `setPauseChecker` 注入 hook，进入 think 前检查。",
      rationale:
        "让 scheduler 不依赖 HTTP / pause 模块，保持单测纯净；pause 概念以「扩展点」形式注入。",
    },

    layeringSeparation: {
      kind: "invariant",
      title: "scheduler 不知道 HTTP / 持久化 / pause 概念",
      summary: "job 队列 + pause hook 把外部概念以扩展点形式注入",
      content:
        "服务化分层让进程内 scheduler 不知道 HTTP / 持久化 / pause 概念；它只看 thread tree 内存对象。job 队列 + pause hook 把这些外部概念以「扩展点」形式注入。",
      rationale:
        "scheduler 可以被 integration 测试在无服务器环境下复用，且未来更换 RPC 框架不会牵动 scheduler 实现。",
    },
  },

  deadlock: {
    title: "死锁检测（设计层面）",
    summary: "全员 waiting 且无唤醒源 → 强翻一个并注入 deadlock_notice",

    definition: {
      title: "定义",
      content: "所有线程都进入 waiting 且没有可触发的唤醒条件 → 死锁。",
    },

    typicalScenarios: {
      title: "典型场景",
      content: `
- 父 talk(wait=true) → 子，子 talk(wait=true) → 父 → 互相等待
- 多线程互相 wait 对方的子线程 → 环形等待
      `.trim(),
    },

    fallbackDesign: {
      kind: "example",
      title: "调度器兜底设计",
      content: `
\`\`\`
if 所有线程都 waiting 且无任何唤醒条件被满足:
  选最久未推进的线程
  强制翻转为 running
  在其 Context 中注入 <deadlock_notice>
  让 LLM 决定如何打破僵局
\`\`\`
      `.trim(),
    },

    notYetImplemented: {
      kind: "invariant",
      title: "当前未实现，仅设计层面记录",
      summary: "保留语义占位避免实现时反向推断",
      content: "调度器兜底当前暂未实现，仅在文档保留以供后续对齐。",
      rationale: "保留语义占位，避免实现时反向推断「为什么这里要这么做」。",
    },
  },

  superFlow: {
    title: "super flow 的独立调度通道",
    summary: "常驻线程树 + SuperScheduler + 元能力承载",

    persistentThreadTree: {
      title: "super 线程树常驻",
      content: `
每个 Object 都有一个名为 super 的特殊 flow。super 的线程树**常驻**——不会因 flow
结束被清理。
      `.trim(),
    },

    independentScheduler: {
      kind: "invariant",
      title: "SuperScheduler 与普通 scheduler 隔离",
      summary: "避免普通 flow 高频 tick 抢占 super 的元思考",
      content: "super 由独立的 SuperScheduler 调度（与普通 flow 的 scheduler 隔离）。",
      rationale:
        "super 承载元能力（反思、改身份），其调度节奏与普通 flow 不同——必须独立，避免普通 flow 的高频 tick 抢占 super 的元思考。",
    },

    superCapabilities: {
      title: "super 通道承载的能力",
      content: `
- Object 的自我反思
- 长期记忆更新
- server method 注册等元编程能力

详见 reflectable。
      `.trim(),
    },
  },

  userException: {
    title: "user object 的调度例外",
    summary: "user 代表人类，不被系统调度；控制面代为推进",

    userObjectDefinition: {
      title: "user object 是什么",
      content: "user 是系统人类用户对应的特殊 Object。",
    },

    userCanMessage: {
      title: "user 可以参与消息交互",
      content: "user.root 持有 talk_window，派送消息到其它 Object。",
    },

    userNotScheduled: {
      kind: "invariant",
      title: "user 的 thread 不被系统调度",
      summary: "worker 跳过 thread.persistence.objectId === \"user\"",
      content:
        'user 的 thread 不由系统调度执行——worker 跳过 `thread.persistence.objectId === "user"` 的 thread。',
      rationale:
        "user 代表人类，没有 LLM 可以「代替用户思考」；让控制面（HTTP API）作为唯一的「user-thread 推进器」。",
    },

    controlPlaneAsUserDriver: {
      title: "控制面代用户产生消息",
      content: `
控制面（HTTP API）直接代用户产生消息，等价于 user thread 上 LLM 调了 talk_window.say。

详见 collaborable 文档与 sources.flowsService 中的 USER_OBJECT_ID 处理路径。
      `.trim(),
    },
  },
};
