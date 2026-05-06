import { collaborable_v20260504_1 } from "@meta/object/collaborable/index.doc";

export const talk_v20260506_1 = {
    parent: collaborable_v20260504_1,
    index: `
Talk 是对象间消息传递的核心机制——也是 collaborable 维度最基础的能力。

talk 与 do 的对偶：
- do   操作**当前对象**的线程
- talk 操作**其他对象**或**自己其他线程**的消息投递

注：talk 本身作为一个 command 的参数细节（args 表 / context 模式）见 executable/actions/commands/talk。
本文聚焦"作为协作机制"的 talk 行为：投递路径、inbox、跨对象语义、特殊 target、防循环。

## 基本语义

\`\`\`
talk(target, msg, context, threadId?, wait?)
\`\`\`

- target 指定接收方（一个 Object 名 / 一个具体 thread ID / 保留名 user / super / creator）
- msg 是消息内容（字符串或结构化对象，如 { method, args }）
- context ∈ { fork, continue, new } 决定路由模式
- wait=true 时本线程进入 waiting，等对方回复后唤醒

## 投递路径与四种模式

| context | threadId | 行为 |
|---|---|---|
| new       | （省略） | 在对方对象的根线程下派生新子线程承接消息 |
| fork      | （省略） | 同 new |
| fork      | X        | 在对方某条已有线程 X 下派生子线程（嵌套派生） |
| continue  | X        | 把消息直接投递到对方某条已有线程 X 的 inbox |
| continue  | （省略） | 错误：拒绝；inbox 写入提示 |

continue 模式投递时若目标线程已 done，新 inbox 消息会自动让该线程翻回 running——
done 不是终点，任何新消息都能复活线程（详见 thinkable/thread）。

## 保留 target

| target | 含义 |
|---|---|
| user      | 系统用户（人类）。由 world 特判：消息追加到 \`flows/{sid}/user/data.json\` 的 inbox 引用列表，**不**触发 ThinkLoop |
| super     | 自反思镜像分身。由 world 特判：消息落入 \`stones/{fromObject}/super/\` 的独立线程树（详见 reflectable/super-flow） |
| creator   | 本线程的创建者（user / 父线程ID / 外部对象名）。系统按 creator 的实际值路由 |
| 其他      | 普通对象，按一般跨对象 talk 流程处理 |

\`creator\` 是子线程"完成回报"的标准用法——
不再需要专门的 return command，直接 \`talk(target=creator, msg=summary)\` 即可。

## inbox：消息的接收端

每个线程都有自己的 inbox（持久化在 thread.json 的 \`inbox\` 数组）。
任何 talk 投递最终走到 ThreadsTree.writeInbox 写入目标线程。

每条 inbox 消息字段：

\`\`\`typescript
interface ThreadInboxMessage {
  id: string;
  from: string;                         // 发送方对象名
  content: string;                      // 消息内容
  timestamp: number;
  source: "talk" | "issue" | "thread_error" | "system";
  status: "unread" | "marked";
  mark?: { type: "ack" | "ignore" | "todo", tip: string, markedAt: number };
  form?: TalkFormPayload;               // 对方发来的 form（结构化选项）
  formResponse?: FormResponse;          // 对方对本方先前 form 的回复
  kind?: string;                        // 半结构化通知类型，如 "relation_update_request"
}
\`\`\`

inbox 是**线程级**的——同对象的不同线程，inbox 完全独立。

### 已标记消息保留在 Context

mark（ack / ignore / todo）只是更新状态，**不**从 inbox 中删除消息。
Context 渲染时会区分"未读"vs"已标记"两段，让 LLM 既看到新情况又能回看历史。

详见 executable/actions/tools/mark。

### 溢出保护

引擎对 inbox 设有兜底阈值：
- 未读 > 50 条：按 timestamp 升序，最早的未读自动 mark(ignore, "inbox 溢出")
- 已标记 > 200 条：清理最早的，仅保留最近 100 条

防止对象注意力被无限堆积的消息淹没。

## wait 行为：同步等待

\`talk(..., wait=true)\` = talk + waitingType=talk_sync。

\`\`\`
A 当前线程 → talk(B, msg, wait=true)
  ↓
消息投递到 B
  ↓
A 线程 status: running → waiting (waitingType: talk_sync)
  ↓
B 处理完消息后 talk(target=creator|对应线程ID, ...) 回复
  ↓
回复消息写入 A 的 inbox → 触发 talk_sync 唤醒 → A 线程 running
\`\`\`

特殊情形：

- \`wait=true && target="user"\`：自动降级为 wait=false（user 不会回复，避免死锁）
- \`wait=true\` 但对方长时间不回：当前无超时；调用方需要超时控制时自行起一个定时器子线程
- \`wait=true\` 在循环依赖中：调度器有死锁兜底（详见 thinkable/thread/scheduler）

## 跨对象协作：Session + 线程树联动

一个 Session 内多个对象通过 talk 协同：

\`\`\`
Session sess_xyz
  ├── ThreadsTree (supervisor)
  ├── ThreadsTree (alan)
  └── ThreadsTree (bruce)

supervisor talk("alan", ...)
  → alan 的 Flow 在 sess_xyz 下自动创建（如未存在）
  → alan 的根线程下派生新子线程承接消息
  → alan 子线程独立 ThinkLoop

alan 处理完后 talk(target=creator, ...)
  → creator 是 supervisor 调用线程的 ID
  → 消息投递回 supervisor 调用线程的 inbox
\`\`\`

跨对象 talk 不会"自动创建对象"——目标对象必须已注册（World.registry 中存在）。
未找到时：写入 \`[talk 失败] 对象 X 不存在\` 到调用方 inbox（source=system）。

## 三种协作模式

### 并行独立

多个 talk(wait=true) 并发发起：

\`\`\`
Promise.all([
  talk("alan",  msg1, wait=true),
  talk("bruce", msg2, wait=true),
])
\`\`\`

调用方进入 waiting，所有目标完成后统一唤醒。

### 串行协作

一个接一个 await：

\`\`\`
const designSummary = await talk("alan", "设计 X", wait=true);
const codeSummary   = await talk("coder", designSummary, wait=true);
\`\`\`

每个 await 让本线程逐次进入 waiting → 唤醒。

### 讨论式（看板）

多对象在同一个 Issue 下评论讨论。详见 collaborable/kanban。

## 防无限循环

同一 Session 内所有 talk 共享一个轮次计数器，超过上限时拒绝发送：

\`\`\`
[错误] 对话轮次过多（100），无法继续。请检查是否存在对话循环。
\`\`\`

防止"A talk B talk A talk B..."无限往复消耗资源。

## 错误场景

| 场景 | 行为 |
|---|---|
| target 缺失 / 等于 self | inject 错误事件到调用方线程，本次 talk 不发送 |
| context=continue 缺 threadId | inject \`[错误] talk(context="continue") 必须同时指定 threadId 参数\` |
| 目标对象不存在 | inject \`[talk 失败] 对象 X 不存在\` |
| 跨对象 talk 内部抛错 | 被捕获为系统消息，不影响调用方继续运行 |

## 不可变

消息一旦写入 inbox：
- 不能撤回
- 不能改写
- 只能通过新消息"更正"

历史是客观事实——这跟 do 派生子线程产生的 events 一样不可变。
`,
};
