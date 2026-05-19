import type { Concept, DocNode, ExampleNode, InvariantNode } from "@meta/doc-types";
import { thinkable_v20260504_1 } from "@meta/object/thinkable/index.doc";
import { scheduler_v20260505_1 } from "@meta/object/thinkable/thread/scheduler.doc";
import * as contextEntry from "@src/thinkable/context";
import * as doCommand from "@src/executable/windows/root/do";

/* ────────────────────────────────────────────────────────────────
 *  目录页：Thread 概念骨架
 * ──────────────────────────────────────────────────────────────── */

/**
 * Thread 概念：Object 思考的运行时结构 —— 一棵 Thread Tree，每个节点独立持有 context。
 *
 * sources:
 *  - contextEntry — ThreadContext / ThreadStatus / 子线程嵌套字段定义
 *  - doCommand    — root.do command 的 fork 实现（派生子线程的入口）
 */
export type ThreadConcept = Concept & {
  sources: {
    contextEntry: typeof contextEntry;
    doCommand: typeof doCommand;
  };

  /** Thread Tree 的拓扑与父子关系 */
  shape: {
    title: string;
    summary?: string;
    topologyDiagram: ExampleNode;
    /** 节点独立持有 ThreadContext */
    nodeIndependence: InvariantNode;
    /** 跨线程信息流必须显式经过 message / transcript */
    crossThreadFlowConstraint: InvariantNode;
  };

  /** 节点状态机 */
  states: {
    title: string;
    summary?: string;
    stateTable: DocNode;
    transitionDiagram: ExampleNode;
    /** 仅 running 被调度 */
    runningOnlySchedulable: InvariantNode;
    /** failed 的唤醒行为同 done */
    failedSameAsDoneWakeup: InvariantNode;
  };

  /** 子线程派生：为什么需要、如何创建、生命周期 */
  forkChild: {
    title: string;
    summary?: string;
    content?: string;
    rationaleFocus: DocNode;
    rationaleScopeIsolation: DocNode;
    rationaleParallelism: DocNode;
    lifecycle: ExampleNode;
    /** creator do_window 不可被 LLM close */
    creatorWindowImmutable: InvariantNode;
    /** 无专门 return 机制 */
    noReturnPrimitive: InvariantNode;
  };

  /** 向已创建子线程追加消息 */
  continueChild: {
    title: string;
    summary?: string;
    content?: string;
    doneAutoRevival: DocNode;
    markerWithLastExecutedAt: DocNode;
    waitTrueSynchronization: DocNode;
  };

  /** 调度策略与唤醒规则（独立子概念） */
  scheduler: Concept;
};

/* ────────────────────────────────────────────────────────────────
 *  数据填充
 * ──────────────────────────────────────────────────────────────── */

export const thread_v20260505_1: ThreadConcept = {
  name: "Thread",
  get parent() {
    return thinkable_v20260504_1;
  },
  sources: {
    contextEntry,
    doCommand,
  },
  description: `
Thread 描述 Object 思考的运行时结构。Object 的运行时 = 一棵 Thread Tree，
每个节点 = 一个 Thread，节点之间通过 inbox / outbox 协作。
`.trim(),

  shape: {
    title: "拓扑",
    summary: "Thread Tree + 节点独立 context + 跨线程显式通信",

    topologyDiagram: {
      kind: "example",
      title: "树形示意",
      content: `
\`\`\`
根线程 (由系统用户或其他 Object 的 talk 创建)
  ├── 子线程 A (do fork 派生，独立处理一个子任务)
  │   ├── 孙线程 A1
  │   └── 孙线程 A2
  └── 子线程 B
\`\`\`
      `.trim(),
    },

    nodeIndependence: {
      kind: "invariant",
      title: "节点独立持有 ThreadContext",
      summary: "节点之间不共享 contextWindows / inbox / outbox / events",
      content:
        "每个 Thread 节点持有各自独立的 ThreadContext（详见 thinkable.context）。节点之间不共享 contextWindows / inbox / outbox / events。",
      rationale:
        "让线程成为思考的独立单元——某线程的内部决策与状态不会自动渗透到兄弟 / 父线程，避免「共享内存」导致的状态耦合与调试困难。",
    },

    crossThreadFlowConstraint: {
      kind: "invariant",
      title: "跨线程信息流必须显式经过 message / transcript",
      summary: "不存在读取其他线程 events / contextWindows 的隐式通道",
      content: `
任何跨线程信息流都必须显式经过 inbox/outbox 消息或 do_window/talk_window
transcript。不存在「读取其他线程的 events」或「读取其他线程的 contextWindows」这种
隐式通道。
      `.trim(),
      rationale: "所有跨线程影响都要在事件流中留痕，便于 observability 与 replay。",
    },
  },

  states: {
    title: "节点状态",
    summary: "running / waiting / done / failed / paused 5 态",

    stateTable: {
      title: "状态表",
      content: `
| 状态 | 含义 | 典型转换 |
|---|---|---|
| running | 正在执行 ThinkLoop | → waiting / done / failed / paused |
| waiting | 等 inbox 出现新消息（含子线程 end 通知、talk 回信） | → running |
| done    | 任务完成 | → running（任何新 inbox 消息自动唤醒） |
| failed  | 未捕获错误终止 | → running（同 done） |
| paused  | 被控制面 pause | 等待人工 resume，详见 observable.pause |
      `.trim(),
    },

    transitionDiagram: {
      kind: "example",
      title: "状态转换图",
      content: `
\`\`\`
        ┌─────── running ────────┐
        │          ↑             │
        ↓          │             ↓
     waiting ──────┘           done
        │          ↑             │
        │          │             ↓
        └──────────┴────────  failed
                新 inbox 消息
\`\`\`
      `.trim(),
    },

    runningOnlySchedulable: {
      kind: "invariant",
      title: "仅 running 被调度",
      summary: "done 不参与调度，但收到新 inbox 消息会翻回 running",
      content:
        "只有 running 线程会被 Scheduler 选中执行下一轮 ThinkLoop；done 不参与调度。但 done 收到任何新 inbox 消息会自动翻回 running。",
      rationale: "让 task-finished thread 仍能被后续协作消息「复活」，不强制创建新线程。",
    },

    failedSameAsDoneWakeup: {
      kind: "invariant",
      title: "failed 的唤醒行为同 done",
      summary: "新 inbox 消息到达时 failed 也翻回 running",
      content:
        "failed 线程在新 inbox 消息到达时同样翻回 running——让上游 / 协作方有机会「重启」失败的线程，而不是强制创建新线程。详见 scheduler.wakeup。",
      rationale: "保持「线程死了 → 来一条新消息能复活」的语义统一，简化上游错误处理路径。",
    },
  },

  forkChild: {
    title: "子线程派生（do fork）",
    summary: "焦点 / 作用域 / 并行三条理由 + 完整生命周期",
    content: `
通过 \`open(command="do", title="...", args={ msg: "...", wait?: true })\`
在当前线程下创建新节点（child thread）。
    `.trim(),

    rationaleFocus: {
      title: "理由 1：保持焦点",
      content:
        "当前线程在做 A，需要中途做子任务 B 时，开子线程做 B，避免 B 的思考污染 A 的 Context。",
    },

    rationaleScopeIsolation: {
      title: "理由 2：作用域隔离",
      content:
        "子任务可能需要不同的 knowledge 集合；独立线程能让 commandPath 激活与父线程互不干扰。",
    },

    rationaleParallelism: {
      title: "理由 3：并行",
      content: "多个独立子任务可以并行（由 Scheduler 公平轮询执行）。",
    },

    lifecycle: {
      kind: "example",
      title: "生命周期",
      content: `
\`\`\`
父线程 open(command="do", ...)
  ↓
创建子节点 (status=running, creatorThreadId=父 thread.id)
系统自动在子节点 contextWindows 注入指向父的初始 creator do_window
  ↓
Scheduler 调度子线程独立运行 ThinkLoop
  ↓
子线程完成任务后，通过 creator do_window 的 say 把结果送回父
（或在跨对象场景下走 talk_window）
  ↓
子线程调 end 进入 done（或 wait 进入 waiting）
  ↓
scheduler 检测 child status=done，在父 inbox 写一条 system 消息触发唤醒
（详见 scheduler 子概念 § 子线程结束通知）
\`\`\`
      `.trim(),
    },

    creatorWindowImmutable: {
      kind: "invariant",
      title: "creator do_window 不可被 LLM close",
      summary: "isCreatorWindow=true 标记，close 被 reject",
      content: `
子线程被创建时系统自动注入的初始 creator do_window 带 \`isCreatorWindow=true\` 标记，
**不可**被 LLM 通过 close 关闭。
      `.trim(),
      rationale:
        "creator window 是子线程报告结果的唯一回流通道。允许 close 等于让子线程「切断与父的联系」——任务完成无处汇报。",
    },

    noReturnPrimitive: {
      kind: "invariant",
      title: "无专门 return 机制",
      summary: "子线程完成任务 = 给 creator 报一句话，与对外协作同源",
      content: `
子线程**不**通过专门的 return 机制把结果送回父——它就是普通地 talk 给自己的
creator。「完成任务 = 给 creator 报一句话」与「对外协作 = 给某个 Object 说话」用同
一个原语。
      `.trim(),
      rationale: "少一个特殊机制，让「汇报结果」与「协作对话」在认知和实现上同源。",
    },
  },

  continueChild: {
    title: "向已有子线程追加任务",
    summary: "open(parent_window_id=..., command=\"continue\", ...) 投递消息",
    content: `
通过 \`open(parent_window_id="<父线程上的 do_window id>", command="continue",
args={ msg: "...", wait?: true })\` 把消息投递到该 do_window 指向的子线程。
    `.trim(),

    doneAutoRevival: {
      title: "子线程已 done 时自动复活",
      content: `
子线程已 done 时，新 inbox 消息自动翻回 running。

让「继续聊」与「重新派任务」等价——不需要额外的 reactivate 命令。
      `.trim(),
    },

    markerWithLastExecutedAt: {
      title: "child-end marker 含 lastExecutedAt",
      content: `
scheduler 的 child-end notification marker 包含 lastExecutedAt，子线程多次 end
都能各自唤醒父一次（详见 scheduler.childEndNotification）。

设计原因：避免父线程在 continue → child 二次 end 的场景里「看不见第二次 end」而死锁。
      `.trim(),
    },

    waitTrueSynchronization: {
      title: "wait=true 父线程同步入眠",
      content: `
wait=true 时父线程同时切到 waiting，等子线程下次 end。

让「派子任务 + 等结果」成为单步动作，不需要 continue 后另起 wait 调用。
      `.trim(),
    },
  },

  scheduler: scheduler_v20260505_1,

  refs: {
    /** 调度策略与唤醒规则的完整子概念 */
    scheduler: scheduler_v20260505_1,
  },
};
