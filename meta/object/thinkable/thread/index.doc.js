import { thinkable_v20260504_1 } from "@meta/object/thinkable/index.doc";
import { scheduler_v20260505_1 } from "@meta/object/thinkable/thread/scheduler.doc";
import * as contextEntry from "@src/thinkable/context";
import * as doCommand from "@src/executable/windows/root/do";

/**
 * Thread 概念：Object 思考的运行时结构 —— 一棵 Thread Tree，每个节点独立持有 context。
 *
 * sources:
 *  - contextEntry — ThreadContext / ThreadStatus / 子线程嵌套字段定义
 *  - doCommand    — root.do command 的 fork 实现（派生子线程的入口）
 */
export const thread_v20260505_1 = {
  name: "Thread",
  get parent() { return thinkable_v20260504_1; },
  sources: {
    contextEntry,
    doCommand,
  },
  description: `
Thread 描述 Object 思考的运行时结构。Object 的运行时 = 一棵 Thread Tree，
每个节点 = 一个 Thread，节点之间通过 inbox / outbox 协作。

按子字段展开：

- shape — Thread Tree 的拓扑与父子关系
- states — 节点状态机（running / waiting / done / failed / paused）
- forkChild — 子线程派生：为什么需要、如何创建、生命周期
- continueChild — 向已创建子线程追加消息
- scheduler — 调度策略与唤醒规则（独立子概念）
`.trim(),

  shape_v20260505_1: {
    index: `
## 拓扑

\`\`\`
根线程 (由系统用户或其他 Object 的 talk 创建)
  ├── 子线程 A (do fork 派生，独立处理一个子任务)
  │   ├── 孙线程 A1
  │   └── 孙线程 A2
  └── 子线程 B
\`\`\`

每个 Thread 节点持有各自独立的 ThreadContext（详见 \`thinkable.context\`），
节点之间不共享 contextWindows / inbox / outbox / events——任何跨线程信息流
都必须显式经过 inbox/outbox 消息或 do_window/talk_window transcript。
`.trim(),
  },

  states_v20260505_1: {
    index: `
## 节点状态

| 状态 | 含义 | 典型转换 |
|---|---|---|
| running | 正在执行 ThinkLoop | → waiting / done / failed / paused |
| waiting | 等 inbox 出现新消息（含子线程 end 通知、talk 回信） | → running |
| done    | 任务完成 | → running（任何新 inbox 消息自动唤醒） |
| failed  | 未捕获错误终止 | → running（同 done） |
| paused  | 被控制面 pause | 等待人工 resume，详见 \`observable.pause\` |

状态转换图：

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

只有 running 线程会被 Scheduler 选中执行下一轮 ThinkLoop；done 不参与调度，
但收到任何新 inbox 消息会自动翻回 running。
`.trim(),
  },

  forkChild_v20260505_1: {
    index: `
## 子线程派生（do fork）

通过 \`open(command="do", title="...", args={ msg: "...", wait?: true })\`
在当前线程下创建新节点（child thread）。

**为什么需要子线程**：

1. 保持焦点：当前线程在做 A，需要中途做子任务 B 时，开子线程做 B，避免 B 的
   思考污染 A 的 Context
2. 作用域隔离：子任务可能需要不同的 knowledge 集合
3. 并行：多个独立子任务可以并行

**生命周期**：

\`\`\`
父线程 open(command="do", ...)
  ↓
创建子节点 (status=running, creatorThreadId=父 thread.id)
系统自动在子节点 contextWindows 注入指向父的初始 creator do_window
（isCreatorWindow=true，不可被 LLM close；详见 executable.concepts.creatorWindow）
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

子线程不通过专门的 return 机制把结果送回父——它就是普通地 talk 给自己的
creator。"完成任务 = 给 creator 报一句话"与"对外协作 = 给某个 Object 说话"
用同一个原语。
`.trim(),
  },

  continueChild_v20260505_1: {
    index: `
## 向已有子线程追加任务

通过 \`open(parent_window_id="<父线程上的 do_window id>", command="continue",
args={ msg: "...", wait?: true })\` 把消息投递到该 do_window 指向的子线程。

特性：
- 子线程已 done 时，新 inbox 消息自动翻回 running
- scheduler 的 child-end notification marker 包含 lastExecutedAt，子线程多次
  end 都能各自唤醒父一次（详见 scheduler 子概念）
- wait=true 时父线程同时切到 waiting，等子线程下次 end
`.trim(),
  },

  scheduler: scheduler_v20260505_1,
};
