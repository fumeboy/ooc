import { commands_v20260506_1 } from "@meta/object/executable/actions/commands/index.doc";
import * as doSource from "@src/executable/commands/do";

export const do_v20260514_1 = {
  get parent() { return commands_v20260506_1; },
  index: `
\`do\` 用于在当前对象内派生子线程，submit 后产出一个 **do_window** 挂在父 thread 的 contextWindows 下。

跟 \`talk\` 的对偶关系：
- do  操作**当前对象（自己）**的线程
- talk 操作**其他对象**的线程（Step 1 暂只支持 talk to user）

## 调用形式（Step 1 新模型 — spec 2026-05-14）

\`\`\`
open(command="do", title="处理告警", args={
  msg: "...",        // 必填，写入子线程 inbox 的初始消息
  wait?: true|false  // 可选，true 则父线程立即 status=waiting
})
\`\`\`

注意 Step 1 弃用：
- 不再有 context="fork" / "continue" 区分；continue 改走 do_window 自身的 continue command
- args.threadId / args.knowledge 不再支持

## submit 副作用

1. 创建 child thread（id 生成、persistence ref 派生）
2. 在 child.contextWindows 下挂指向父的初始 creator do_window（不可被 LLM close）
3. 写消息到 child.inbox + 父.outbox + child 记 inbox_message_arrived 事件
4. 在父.contextWindows 下挂一个 do_window，targetThreadId=childId
5. wait=true 则父进入 status="waiting"，scheduler 见父 inbox 增长后唤醒

## do_window 上注册的 command

- \`continue\` (args: msg, wait?) — 追加消息到子线程；wait=true 同样使父进入 waiting
- \`wait\` — 不发消息，仅等待
- \`close\` — 归档子线程对话（B=ii archive）

调用方式：

\`\`\`
open(parent_window_id="<do_window_id>", command="continue", title="追加任务", args={ msg: "再处理一批", wait: true })
\`\`\`

## Path 列表

root.do：
\`\`\`
do
do.wait
\`\`\`

do_window 上：
\`\`\`
continue
continue.wait
wait
close
\`\`\`

## 子线程的 Context 继承

设计目标上，子线程可以继承父线程知识；但当前 thinkable/knowledge 没有实现父链 knowledge 自动继承。
当前已实现：子线程一旦创建就自带"指向父 thread 的初始 creator do_window"作为锚点（替代旧的"处理初始消息" todo form）。
`,
  sources: {
    do: doSource,
  },
};
