import { commands_v20260506_1 } from "@meta/object/executable/actions/commands/index.doc";
import * as doSource from "@src/executable/commands/do";

export const do_v20260506_1 = {
  get parent() { return commands_v20260506_1; },
  index: `
\`do\` 用于在当前对象内派生子线程，或向当前对象内已有子线程追加消息。

跟 \`talk\` 的对偶关系：
- do  操作**当前对象（自己）**的线程
- talk 操作**其他对象**的线程

## 调用形式

\`\`\`
open(type=command, command=do, title="…", description="…")
refine(form_id, {
  context:   "fork" | "continue",                  // 必填
  msg:       "…",                                  // 必填
  threadId?: "…",                                  // context=continue 时必填；fork 时可为空，默认当前 thread
  knowledge?: ["..."],                             // fork 时给子线程额外引入的 knowledge path 列表
  wait?:     true | false                          // fork 时是否同步等待子线程完成
})
submit(form_id)
\`\`\`

## context 模式

### context=fork

派生新子线程：
- 父线程：默认当前线程；可通过 threadId 显式指定
- 创建子节点（status=running, creator=父线程ID）
- 系统自动注入"处理初始消息"的 todo form
- msg 会变成一条 thread message，写入子线程 inbox，同时在子线程 events 中记录 \`inbox_message_arrived\`
- 同一条 message 也会进入父线程 outbox，形成线程间往来痕迹
- 若 wait=true，父线程进入 waiting (waitingType=await_children)，等子线程完成

### context=continue

向已有线程追加消息：
- threadId 必填
- 把 msg 写入该线程 inbox
- 若目标线程处于 done/failed，自动翻回 running
- 若 wait=true，父线程进入 waiting (waitingType=await_children)，等待目标线程再次完成

### 约束：

- continue/fork 查找目标线程时，只在**当前线程子树**内查找，不会跨 object 或跨 session 找线程。

### continue + wait 示例（supervisor 给已完成的子线程追加任务并等结果）：

\`\`\`
open(type=command, command=do, description="给 task A 已完成的子线程追加 task B")
refine(form_id, {
  context: "continue",
  threadId: "t_child",
  msg: "再数 src/thinkable 下的 ts 文件",
  wait: true
})
submit(form_id)
\`\`\`

## Path 列表

\`\`\`
do
do.fork
do.continue
do.wait
\`\`\`

## 子线程的 Context 继承

设计目标上，子线程可以继承父线程知识；但当前源码与 thinkable/knowledge 的现状是：**没有实现父链 knowledge 自动继承**。

当前已稳定实现的是：子线程创建后自动带一条“处理初始消息”的 todo form，作为它第一轮思考的入口锚点。
`,
  sources: {
    do: doSource,
  },
};
