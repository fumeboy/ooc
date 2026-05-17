import { tools_v20260506_1 } from "@meta/object/executable/actions/tools/index.doc";
import * as waitSource from "@src/executable/tools/wait";

export const wait_v20260506_1 = {
  get parent() { return tools_v20260506_1; },
  name: "Wait",
  sources: { wait: waitSource },
  description: `
\`wait\` 声明本线程在等指定 window 上的未来 IO 事件，把当前线程切到 \`status=waiting\`。

\`wait\` 是 5 原语里唯一可能"无所事事"的原语，因此 \`on\` 强制必填且必须 resolve 到
一个允许产生未来 IO 的 open window。无合法候选时直接 reject 并 nudge 改 \`end\`。

按子字段展开：

- callShape — 调用形态与参数语义
- validTargets — \`on\` 允许指向的 window 类别与各自存活判定
- rejectBranches — 5 条 reject 分支（R1–R5），各对应一种不合法形态
- successEffects — 校验通过后写入的字段与 scheduler wakeup 规则
- variantComparison — 与 \`do(wait=true)\` / \`talk(wait=true)\` 及 \`end\` 的对比
`.trim(),

  callShape_v20260517_1: {
    index: `
\`\`\`
wait(
  on="<window_id>",       // 必填：指向 contextWindows 中一个 open 的 talk_window 或 do_window
  reason="…"              // 可选：observability 用，不参与决策
)
\`\`\`

\`on\` 是机器可解析的 window id，不是自然语言描述；\`reason\` 仅入 observability，
不影响 reject / accept 决策。
`.trim(),
  },

  validTargets_v20260517_1: {
    index: `
\`on\` 允许指向的 window 类别有限——只有"可能产生未来 IO"的 window 才合法：

- \`talk_window\` (status=open) — 详见子字段 talkCreator / talkSelfBuilt
- \`do_window\` (status=running) — 详见子字段 doRunning

其余类型（root / command_exec / file / knowledge / search / program / todo）一律不能
作为 \`on\` 目标——它们不产生未来 IO，会被 R3 拒绝。
`.trim(),

    talkCreator_v20260517_1: {
      index: `
### creator talk_window

\`isCreatorWindow=true\` 的 talk_window 一律视为合法候选——等创建者后续指令。
不要求本线程先 \`say\` 过，因为对端就是创建者，本来就持有这个对话句柄。
`.trim(),
    },

    talkSelfBuilt_v20260517_1: {
      index: `
### LLM 自建 talk_window

\`isCreatorWindow=false\` 的 talk_window 必须先 \`say\` 过一次才合法——
对端如果还没收到任何消息，就不存在"等回信"这一行为，等于 LLM 在空等。

判定方式：\`thread.outbox\` 中是否存在 \`windowId === <talk_window.id>\` 的消息。
未 say 过的自建 talk_window 会被 R4 单独点名。
`.trim(),
    },

    doRunning_v20260517_1: {
      index: `
### do_window (status=running)

\`status=running\` 的 do_window 永远合法——等子线程 outbox 回报。
\`status\` 为其它值（如归档后的 closed）不算合法候选。
`.trim(),
    },
  },

  rejectBranches_v20260517_1: {
    index: `
\`handleWaitTool\` 的 5 条 reject 分支按顺序检查；任一命中即直接 reject。
每条分支返回时附上当前 thread 的合法候选列表，便于 LLM 自纠。
`.trim(),

    r5NoCandidate_v20260517_1: {
      index: `
### R5 — thread 没有任何合法候选

最先检查（先于 R1）：thread.contextWindows 不含任何 open talk / running do →
直接 reject，强 nudge 改 \`end\` command。

意图：阻断"任务已做完、想 wait 歇着等下一次召唤"——正确收尾应走 \`end\`。
`.trim(),
    },

    r1MissingOn_v20260517_1: {
      index: `
### R1 — \`on\` 缺失或类型错

\`on\` 不是非空字符串 → reject。提示 LLM 必须显式选一个 window id。
`.trim(),
    },

    r2WindowNotFound_v20260517_1: {
      index: `
### R2 — \`on\` 指向的 window 不存在

\`on\` 在 \`thread.contextWindows\` 中查不到 → reject。常见于 LLM 复述旧
window id 或拼写错误。
`.trim(),
    },

    r3WrongType_v20260517_1: {
      index: `
### R3 — \`on\` 指向的 window 类型不合法

window 存在但 type 不是 talk / do（root / command_exec / file / knowledge /
search / program / todo）→ reject。这条同时覆盖了所有"非 IO" window 类型，
不用为每种类型写独立分支。
`.trim(),
    },

    r4SelfBuiltUnsaid_v20260517_1: {
      index: `
### R4 — 自建 talk_window 但未 say 过

talk_window 合法但 \`isCreatorWindow=false\` 且 thread.outbox 中无对应 windowId
消息 → reject，单独点名提示"先 say 再 wait"。
`.trim(),
    },
  },

  successEffects_v20260517_1: {
    index: `
5 条 reject 都不命中 → 校验通过，写入 thread 三个字段，scheduler 据此唤醒。
`.trim(),

    threadStatus_v20260517_1: {
      index: `
### thread.status = "waiting"

线程主状态切到 waiting；thinkloop 不再驱动它，直到 scheduler 翻醒。
`.trim(),
    },

    inboxSnapshot_v20260517_1: {
      index: `
### thread.inboxSnapshotAtWait = thread.inbox.length

记录进入 waiting 那刻 inbox 长度。scheduler tick 比较 \`inbox.length > snapshot\`
即翻回 running，并清空 snapshot 与 waitingOn 两个字段。
`.trim(),
    },

    waitingOn_v20260517_1: {
      index: `
### thread.waitingOn = on

仅作 observability，让外部能看出该线程在等哪个 window。
不参与 scheduler wakeup 决策——唤醒依据只是 inbox 长度增长。
`.trim(),
    },
  },

  variantComparison_v20260517_1: {
    index: `
\`wait\` 与 \`do(wait=true)\` / \`talk(wait=true)\` 三者底层语义一致——唤醒条件都是
inbox 长度增长。差异仅在调用时机与 \`waitingOn\` 写什么。
`.trim(),

    waitTool_v20260517_1: {
      index: `
### \`wait(on=<id>)\`

显式调一次 wait tool，\`waitingOn\` = 传入的 \`on\`。
适合"已经做完一轮动作、决定开始等"的场景。
`.trim(),
    },

    doWaitFlag_v20260517_1: {
      index: `
### \`do(args.wait=true)\` (submit 时)

子线程创建后立即把父切到 waiting；\`waitingOn\` = 新建的 do_window.id。
省一次 wait tool 调用。
`.trim(),
    },

    talkWaitFlag_v20260517_1: {
      index: `
### \`talk_window.say(wait=true)\`

发完消息立即把父切到 waiting；\`waitingOn\` = 该 talk_window.id。
对端回复进 inbox 即唤醒。
`.trim(),
    },

    endComparison_v20260517_1: {
      index: `
### 与 \`end\` 的区别

| Command/Tool | 状态 | 是否还能被唤醒 |
|---|---|---|
| \`wait\` (tool) | waiting | 是（任意 inbox 消息） |
| \`end\` (command) | done | 是（任意 inbox 消息会翻回 running） |

- \`wait\` 表达"我的事情没结束，等待更多消息来推进"——需要有明确"等什么"
- \`end\` 表达"本线程任务完结，若有新情况可再来找我"——没有 IO 依赖时的正确收尾

任务做完想"歇会儿"想用 \`wait\` → 没合法 \`on\` 候选会被 R5 reject，应该走 \`end\`。
`.trim(),
    },
  },
};
