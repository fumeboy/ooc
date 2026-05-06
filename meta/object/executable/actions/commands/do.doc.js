import { commands_v20260506_1 } from "@meta/object/executable/actions/commands/index.doc";

export const do_v20260506_1 = {
    parent: commands_v20260506_1,
    index: `
\`do\` 用于在当前对象内派生子线程，或向已有子线程追加消息。

跟 \`talk\` 的对偶关系：
- do  操作**当前对象**的线程
- talk 操作**其他对象**或**自己其他线程**的消息投递

## 调用形式

\`\`\`
open(type=command, command=do, description="…")
refine(form_id, {
  context:   "fork" | "continue",                  // 必填
  msg:       "…",                                  // 必填
  threadId?: "…",                                  // context=continue 时必填；fork 时为父
  knowledge?: ["..."],                             // fork 时给子线程额外引入的 knowledge id 列表
  wait?:     true | false                          // fork 时是否同步等待子线程完成
})
submit(form_id)
\`\`\`

## context 模式

### context=fork

派生新子线程：
- 父：默认当前线程；可通过 threadId 显式指定
- 创建子节点（status=running, creator=父线程ID）
- 系统自动注入"处理初始消息"的 todo form
- msg 写入子线程 inbox
- 若 wait=true，父线程进入 waiting (waitingType=await_children)，等子线程完成

### context=continue

向已有线程追加消息：
- threadId 必填
- 把 msg 写入该线程 inbox
- 若该线程已 done，自动翻回 running

## Path 列表

\`\`\`
do
do.fork
do.continue
do.wait
\`\`\`

## 触发的 knowledge

默认激活 \`kernel:plannable\`（show_content_when 含 \`do\` / \`plan\`）。
描述何时该开子线程、子线程作用域如何继承父、wait 的语义等。

## 子线程的 Context 继承

子线程的 Context 通过 scope chain 自动继承父线程的全部 \`activatedKnowledge + pinnedKnowledge\`。
若 do(fork) 显式传入 \`knowledge\` 参数，这些 id 追加到子节点的 \`node.knowledge\` 静态声明，
也会被 scope chain 收集。

详见 thinkable/thread 的 "Scope Chain" 段落。

## do 与 talk 的选择

| 任务性质 | 用 do 还是 talk |
|---|---|
| 在当前对象的能力范围内能完成 | do |
| 需要另一个对象的专业能力 | talk |
| 同对象但需要独立 Context（避免污染当前线程） | do(fork) |
| 同对象但要让其他线程继续 | talk(target=&lt;thread_id&gt;) |
`,
};
