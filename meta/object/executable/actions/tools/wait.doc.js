import { tools_v20260506_1 } from "@meta/object/executable/actions/tools/index.doc";
import * as waitSource from "@src/executable/tools/wait";

export const wait_v20260506_1 = {
  get parent() { return tools_v20260506_1; },
  index: `
\`wait\` 用于让当前线程主动等待新消息。

\`\`\`
wait(
  reason="…"                 // 简短说明等什么
)
\`\`\`

## 行为

1. 把当前线程 status 从 running 设为 waiting，waitingType = explicit_wait (主动等待)
2. Scheduler 不再调度该线程

需要注意：文档层的目标语义是“等任意 inbox 消息后自动唤醒”，但当前源码里 scheduler 还**没有**实现 explicit_wait 的 inbox 唤醒；目前 wait 已落地的是状态翻转本身，真正的显式唤醒还待后续补齐。

## 与 do(wait=true) / talk(wait=true) 的区别

| 形式 | 等什么
|---|---|---|
| \`wait\` | 任意新事件
| \`do(fork, wait=true)\` | 预期是等指定子线程，但任意 inbox 消息都可以唤醒
| \`talk(target, wait=true)\` | 等对方回复，但任意 inbox 消息都可以唤醒

\`do(wait=true)\` / \`talk(wait=true)\` 本质上是隐式 wait——执行 command 完毕后自动设置
对应 waitingType（await_children / talk_sync），通过 submit 触发，不需要显式调用 wait tool。

## 与 end 的区别

| Command/Tool | 状态 | 是否还能被唤醒 |
|---|---|---|
| \`wait\`(这是 tool) | waiting | 是（任意 inbox 消息） |
| \`end\` (这是 command) | done | 是（任意 inbox 消息会翻回 running） |

两者都允许后续 inbox 消息继续推进线程。区别是：
- \`wait\` 表达"我的事情没结束，等待更多消息来帮助推进工作"
- \`end\` 表达"我认为本线程的任务已完结，但若有新情况可以再来找我"
`,
  sources: {
    wait: waitSource,
  },
};
