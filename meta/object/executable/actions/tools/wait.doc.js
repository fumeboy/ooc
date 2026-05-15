import { tools_v20260506_1 } from "@meta/object/executable/actions/tools/index.doc";
import * as waitSource from "@src/executable/tools/wait";

export const wait_v20260506_1 = {
  get parent() { return tools_v20260506_1; },
  name: "Wait",
  get description() { return this.index; },
  index: `
\`wait\` 用于让当前线程主动等待新消息。

\`\`\`
wait(
  reason="…"                 // 简短说明等什么
)
\`\`\`

## 行为（Step 1 spec 2026-05-14）

1. 把当前线程 status 从 running 设为 waiting
2. 写入 \`thread.inboxSnapshotAtWait = thread.inbox?.length ?? 0\` 作为入眠快照
3. Scheduler 每 tick 比较 \`inbox.length > snapshot\` 即翻回 running 并清空 snapshot

\`waitingType\` 字段已取消——所有"等待"语义统一为"等 thread.inbox 出现新消息"。

## 与 do(wait=true) / talk(wait=true) 的区别

| 形式 | 等什么 |
|---|---|
| \`wait\` | 任意新 inbox 消息 |
| \`do(fork, wait=true)\` | 子线程结束时 scheduler 给父 inbox 写一条 system 消息触发唤醒 |
| \`talk(target, wait=true)\` | 对方回复直接进 inbox 触发唤醒 |

三者底层语义完全一致：唤醒条件就是 inbox 长度增长。
\`do(wait=true)\` / \`talk(wait=true)\` 只是把"切到 waiting"的动作绑在 submit 那一步，省一次 wait tool 调用。

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
