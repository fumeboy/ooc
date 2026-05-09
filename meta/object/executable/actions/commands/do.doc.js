import { commands_v20260506_1 } from "@meta/object/executable/actions/commands/index.doc";
import * as doSource from "@src/executable/commands/do";

export const do_v20260506_1 = {
  parent: commands_v20260506_1,
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
- msg 写入子线程 inbox
- 若 wait=true，父线程进入 waiting (waitingType=await_children)，等子线程完成

### context=continue

向已有线程追加消息：
- threadId 必填
- 把 msg 写入该线程 inbox

## Path 列表

\`\`\`
do
do.fork
do.continue
do.wait
\`\`\`

## 子线程的 Context 继承

子线程的 Context 自动继承父线程的全部已激活的知识。
若 do(fork) 显式传入 \`knowledge\` 参数，这些 knowledge 追加到子节点的 \`node.knowledge\` 静态声明
`,
  sources: {
    do: doSource,
  },
};
