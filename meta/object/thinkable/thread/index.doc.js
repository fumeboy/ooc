import { thinkable_v20260504_1 } from "@meta/object/thinkable/index.doc";

export const thread_v20260505_1 = {
    parent: thinkable_v20260504_1,
    index: `
Thread 描述 Object 思考的运行时结构。

Object 的运行时 = 一棵 Thread Tree。
每个节点 = 一个 Thread = 一层认知作用域。

\`\`\`
根线程 (由用户消息或 talk 创建)
  ├── 子线程 A (do(fork) 派生，独立处理一个子任务)
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
done 线程不参与调度，但收到任何新 inbox 消息会自动翻回 running——
done 不是终点，只是"当前没事可做"。failed 是真正的终态。

## 子线程（do fork）

通过 \`do(context="fork", msg=...)\` 在线程树下创建新节点。

为什么需要子线程：

1. 保持焦点：当前线程在做 A，需要中途做子任务 B 时，开子线程做 B，避免 B 的思考污染 A 的 Context
2. 作用域隔离：子任务可能需要不同的 knowledge 集合（例如临时做代码审查）
3. 并行：多个独立子任务可以并行；用 do(wait=true) 显式等待

参数：
- context        必须为 "fork"
- msg            子线程首轮 inbox + description
- threadId       以哪个线程为父（省略则当前线程）
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
子线程进入 done（无 inbox 消息时自然停转）
  ↓
父线程收到 inbox 消息（如果在 wait，则恢复 running）
\`\`\`

注：任何线程（root / sub_thread / talk 进入）创建时都会自动注入一份"处理初始消息"的 todo form，
作为本线程任务的入口锚点。LLM 处理完后 submit 该 todo 即可关闭。
详见 context/index 的 activeForms 段落。

子线程不通过专门的 return 机制把结果送回父——
它就是普通地 talk 给自己的 creator（父线程的 ID）。
"完成任务 = 给 creator 报一句话" 与"对外协作 = 给某个 Object 说话"用同一个原语。

向已创建的子线程追加消息：do(context="continue", threadId=..., msg=...)
- 如果子线程已 done，新 inbox 消息会自动翻回 running

## Scope Chain（作用域链）

线程树的当前节点沿树**向上**收集，决定哪些 knowledge 在本线程的 Context 中可见。

\`\`\`
根线程 (激活: A, B)
   ↓
子线程 (激活: C)
   ↓
孙线程 (激活: D)
\`\`\`

孙线程的 Context 中 knowledge = A + B + C + D（向上收集，去重）。

收集的双重来源：
1. node.knowledge      声明式：创建子线程时通过 do(fork) 的 knowledge 参数显式声明
2. node.activatedKnowledge  运行时：渐进式披露在执行过程中通过 activateKnowledge() 动态激活

scope chain 同时收集两类，按 Root → leaf 顺序遍历，去重保留首次出现。

可见 / 不可见：

- 子节点可见父节点的：声明的 knowledge + 已激活的 knowledge
- 子节点**不**可见父节点的：events 历史、inbox、activeForms
- 父节点可见子节点的：仅 childrenSummary（子线程摘要） + 子线程通过 talk 投递到父 inbox 的消息

意义："共享能力，隔离状态"——能力沿树继承，思考过程相互独立。

## 调度

如何选择哪个线程执行下一轮，详见 [scheduler](./scheduler.doc.js)。
`,
};
