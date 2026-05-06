import { tools_v20260506_1 } from "@meta/object/executable/actions/tools/index.doc";

export const wait_v20260506_1 = {
    parent: tools_v20260506_1,
    index: `
\`wait\` 用于让当前线程主动放弃下一轮思考，等待新事件。

\`\`\`
wait(
  reason="…"                 // 简短说明等什么
)
\`\`\`

## 行为

1. 把当前线程 status 从 running 设为 waiting，waitingType = explicit_wait
2. Scheduler 不再调度该线程，直到 inbox 收到任何新消息——届时自动翻回 running

## 与 do(wait=true) / talk(wait=true) 的区别

| 形式 | 等什么 | 唤醒条件 |
|---|---|---|
| \`wait\` | 任意新事件 | 任意 inbox 消息（含其他对象 talk、子线程结果、系统通知） |
| \`do(fork, wait=true)\` | 等指定子线程 | 该子线程进入 done 后 |
| \`talk(target, wait=true)\` | 等对方回复 | 对方 talk 回到本线程 inbox |

\`do(wait=true)\` / \`talk(wait=true)\` 本质上是隐式 wait——执行 command 完毕后自动设置
对应 waitingType（await_children / talk_sync），通过 submit 触发，不需要显式调用 wait tool。

显式 \`wait\` 的典型场景：
- 当前没事可做，但又不想 end（保留可被新消息唤醒的状态）
- 期待某个外部事件（用户回复 / 其他对象主动来 talk）但不知道具体是谁

## 与 end 的区别

| 命令 | 状态 | 是否还能被唤醒 |
|---|---|---|
| \`wait\` | waiting | 是（任意 inbox 消息） |
| \`end\` (command via submit) | done | 是（任意 inbox 消息会翻回 running） |

两者都允许后续 inbox 消息继续推进线程。区别是：
- \`wait\` 表达"我现在没事做，但我知道还会有事"
- \`end\` 表达"我认为本线程的初始任务已完结，但若有新情况可以再来找我"

## 通用参数

- \`mark\` — 同 [mark](./mark.doc.js)
`,
};
