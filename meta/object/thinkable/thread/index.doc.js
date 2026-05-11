import { thinkable_v20260504_1 } from "@meta/object/thinkable/index.doc";
import * as contextSource from "@src/thinkable/context";
import * as doCommandSource from "@src/executable/commands/do";

// doc 仅绑定实现源代码，不再绑定 .test.ts（避免顶层 import meta 时触发 bun:test 运行时）。
export const thread_v20260505_1 = {
  get parent() { return thinkable_v20260504_1; },
  sources: {
    context: contextSource,
    doCommand: doCommandSource,
  },
  index: `
Thread 描述 Object 思考的运行时结构。

Object 的运行时 = 一棵 Thread Tree。
每个节点 = 一个 Thread。

\`\`\`
根线程 (由系统用户或其他对象的 talk 创建)
  ├── 子线程 A (通过 command \`do\` 派生，独立处理一个子任务)
  │   ├── 孙线程 A1
  │   └── 孙线程 A2
  └── 子线程 B
\`\`\`

每个 Thread 节点持有各自独立的 context。

## 节点状态

| 状态 | 含义 | 典型转换 |
|---|---|---|
| running | 正在执行 ThinkLoop | → waiting / done / failed |
| waiting | 等待外部信号（子线程完成、新消息等） | → running |
| done    | 当前任务已完成 | → running（收到新 inbox 消息时自动） |
| failed  | 未捕获错误终止 | （终态，需人工介入或父线程重试） |

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

只有 running 线程会被 Scheduler 选中执行下一轮 ThinkLoop。
done 线程不参与调度，但收到任何新 inbox 消息会自动翻回 running.

## 子线程（do fork）

通过 \`do(context="fork", msg=...)\` 在线程树下创建新节点。

为什么需要子线程：

1. 保持焦点：当前线程在做 A，需要中途做子任务 B 时，开子线程做 B，避免 B 的思考污染 A 的 Context
2. 作用域隔离：子任务可能需要不同的 knowledge 集合（例如临时做代码审查）
3. 并行：多个独立子任务可以并行

参数：
- context        创建子线程时填 "fork" （向已有线程发送消息填 "continue"）
- msg            消息
- threadId       以哪个线程为 parent（省略则当前线程）
- knowledge      子线程额外引入的 knowledge id 列表（可选）
- wait           是否同步等待子线程完成（默认 false）

生命周期：

\`\`\`
父线程 do(fork)
  ↓
创建子节点 (status=running, creator=父线程ID)
系统自动注入一个 todo form：「处理初始消息」
  ↓
Scheduler 调度子线程独立运行 ThinkLoop
  ↓
子线程完成任务后，通过 talk(target=creator, ...) 把结果送回父线程
  ↓
子线程执行 command \`end\` 主动进入 done 或执行 command \`wait\` 主动进入 waiting 状态
  ↓
父线程收到 inbox 消息（恢复 running）
\`\`\`

注：任何线程创建时都会自动注入一份"处理初始消息"的 todo form，
作为本线程任务的入口锚点。LLM 处理完后 submit 该 todo 即可关闭。
详见 context/index 的 activeForms 段落。

子线程不通过专门的 return 机制把结果送回父——
它就是普通地 talk 给自己的 creator（父线程的 ID）。
"完成任务 = 给 creator 报一句话" 与"对外协作 = 给某个 Object 说话"用同一个原语。

向已创建的子线程追加消息：do(context="continue", threadId=..., msg=...)
- 如果子线程已 done，新 inbox 消息会自动翻回 running

## 调度

如何选择哪个线程执行下一轮，详见 [scheduler](./scheduler.doc.js)。
`,
};
