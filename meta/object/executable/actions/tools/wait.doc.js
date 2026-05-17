import { tools_v20260506_1 } from "@meta/object/executable/actions/tools/index.doc";
import * as waitSource from "@src/executable/tools/wait";

export const wait_v20260506_1 = {
  get parent() { return tools_v20260506_1; },
  name: "Wait",
  get description() { return this.index; },
  index: `
\`wait\` 声明你在等指定 window 上的未来 IO 事件，把当前线程切到 waiting。

\`\`\`
wait(
  on="<window_id>",       // 必填：指向 contextWindows 一个 open 的 talk_window 或 do_window
  reason="…"              // 可选：observability 用，不参与决策
)
\`\`\`

## 设计约束（spec 2026-05-17）

\`wait\` 是 OOC 5 原语里唯一可能"无所事事"的原语；为了避免它成为 LLM "我不知道该干嘛"的
逃生口，强制 \`on\` 必填且必须 resolve 到一个允许产生未来 IO 的 window：

- \`talk_window\` (status=open)：等对端发新消息
  - \`isCreatorWindow=true\` 的 creator talk_window：一律合法（等创建者后续指令）
  - LLM 自建的 talk_window：必须先 \`say\` 过一次才合法（否则对端不知道有人在等）
- \`do_window\` (status=running)：等子线程 outbox 回报

其余 window 类型（root / command_exec / file / knowledge / search / program / todo）都不能
作为 \`on\` 目标——它们不产生未来 IO。

若 thread 没有任何合法候选 → \`wait\` 直接 reject，强 nudge 改 \`end\` command。
这是 Bug 2（callee 改完文件不 say、自驱 root 不 end 卡 waiting）的结构性根治。

## 行为

1. 校验 \`on\`（详见 \`src/executable/tools/wait.ts\` handleWaitTool 5 条 reject 分支）
2. 通过则：
   - \`thread.status = "waiting"\`
   - \`thread.inboxSnapshotAtWait = thread.inbox?.length ?? 0\`（wakeup 用，Phase 1 不变）
   - \`thread.waitingOn = on\`（observability，不参与 wakeup 决策）
3. Scheduler 每 tick 比较 \`inbox.length > snapshot\` 即翻回 running，并清空两个字段

## 与 do(wait=true) / talk(wait=true) 的区别

| 形式 | 等什么 | waitingOn 写什么 |
|---|---|---|
| \`wait(on=<id>)\` | 显式声明的 window | =on |
| \`do(fork, wait=true)\` | 子线程结束/回报 | =该 do_window.id |
| \`talk(target, wait=true)\` | 对方回复 | =该 talk_window.id |

三者底层语义一致：唤醒条件都是 inbox 长度增长。
\`do(wait=true)\` / \`talk(wait=true)\` 只是把"切到 waiting"动作绑在 submit 那一步，
省一次 wait tool 调用。Phase 1 wakeup 仍是 inbox 增长就翻醒；Phase 2 可能据 waitingOn
做精确路由。

## 与 end 的区别

| Command/Tool | 状态 | 是否还能被唤醒 |
|---|---|---|
| \`wait\` (tool) | waiting | 是（任意 inbox 消息） |
| \`end\` (command) | done | 是（任意 inbox 消息会翻回 running） |

- \`wait\` 表达"我的事情没结束，等待更多消息来推进"——需要有明确"等什么"
- \`end\` 表达"本线程任务完结，若有新情况可再来找我"——没有 IO 依赖时的正确收尾
- 任务做完想"歇会儿"想用 \`wait\` → 没合法 \`on\` 候选会被 reject，应该走 \`end\`
`,
  sources: {
    wait: waitSource,
  },
};
