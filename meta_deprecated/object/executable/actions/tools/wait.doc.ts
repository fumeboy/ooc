import type { Concept, DocNode } from "@meta/doc-types";
import { tools_v20260506_1 } from "@meta/object/executable/actions/tools/index.doc";
import * as waitSource from "@src/executable/tools/wait";

/* ────────────────────────────────────────────────────────────────
 *  目录页：wait 概念骨架
 * ──────────────────────────────────────────────────────────────── */

/**
 * wait 概念：声明本线程在等指定 window 上的未来 IO 事件，把当前线程切到
 * status=waiting。
 *
 * sources:
 *  - wait — handleWaitTool 实现（5 条 reject 分支 + scheduler 唤醒）
 */
export type WaitConcept = Concept & {
  sources: { wait: typeof waitSource };

  /** 调用形态与参数语义 */
  callShape: DocNode;

  /** on 允许指向的 window 类别与各自存活判定 */
  validTargets: {
    title: string;
    summary?: string;
    /** isCreatorWindow=true 的 talk_window */
    talkCreator: DocNode;
    /** isCreatorWindow=false 的 talk_window（需先 say 过） */
    talkSelfBuilt: DocNode;
    /** status=running 的 do_window */
    doRunning: DocNode;
  };

  /** 5 条 reject 分支，各对应一种不合法形态 */
  rejectBranches: {
    title: string;
    summary?: string;
    /** R5 无合法候选时强 nudge 改 end */
    r5NoCandidate: DocNode;
    /** R1 on 不是非空字符串 */
    r1MissingOn: DocNode;
    /** R2 on 查不到 */
    r2WindowNotFound: DocNode;
    /** R3 window type 不是 talk / do */
    r3WrongType: DocNode;
    /** R4 自建 talk_window 还没 say 过 */
    r4SelfBuiltUnsaid: DocNode;
  };

  /** 校验通过后写入的字段与 scheduler wakeup 规则 */
  successEffects: {
    title: string;
    summary?: string;
    /** thread.status 切 waiting */
    threadStatus: DocNode;
    /** inbox 长度快照 */
    inboxSnapshot: DocNode;
    /** waitingOn observability 字段 */
    waitingOn: DocNode;
  };

  /** 与 do(wait=true) / talk(wait=true) 及 end 的对比 */
  variantComparison: {
    title: string;
    summary?: string;
    /** wait tool 调用形态 */
    waitTool: DocNode;
    /** do submit 时 args.wait=true */
    doWaitFlag: DocNode;
    /** talk_window.say(wait=true) */
    talkWaitFlag: DocNode;
    /** wait 与 end 的语义对比 */
    endComparison: DocNode;
  };
};

/* ────────────────────────────────────────────────────────────────
 *  数据填充
 * ──────────────────────────────────────────────────────────────── */

export const wait_v20260506_1: WaitConcept = {
  name: "Wait",
  get parent() {
    return tools_v20260506_1;
  },
  sources: { wait: waitSource },
  description: `
wait 声明本线程在等指定 window 上的未来 IO 事件，把当前线程切到 status=waiting。

wait 是 5 原语里唯一可能"无所事事"的原语，因此 on 强制必填且必须 resolve 到
一个允许产生未来 IO 的 open window。无合法候选时直接 reject 并 nudge 改 end。
`.trim(),

  callShape: {
    title: "调用形态",
    summary: "on 必填且机器可解析；reason 仅入 observability",
    content: `
\`\`\`
wait(
  on="<window_id>",       // 必填：指向 contextWindows 中一个 open 的 talk_window 或 do_window
  reason="…"              // 可选：observability 用，不参与决策
)
\`\`\`

on 是机器可解析的 window id，不是自然语言描述；reason 仅入 observability，
不影响 reject / accept 决策。
    `.trim(),
  },

  validTargets: {
    title: "合法目标",
    summary: "只有可能产生未来 IO 的 window 才合法——talk_window 或 do_window",

    talkCreator: {
      title: "creator talk_window",
      content: `
isCreatorWindow=true 的 talk_window 一律视为合法候选——等创建者后续指令。
不要求本线程先 say 过，因为对端就是创建者，本来就持有这个对话句柄。
      `.trim(),
    },

    talkSelfBuilt: {
      title: "LLM 自建 talk_window",
      content: `
isCreatorWindow=false 的 talk_window 必须先 say 过一次才合法——
对端如果还没收到任何消息，就不存在"等回信"这一行为，等于 LLM 在空等。

判定方式：thread.outbox 中是否存在 windowId === <talk_window.id> 的消息。
未 say 过的自建 talk_window 会被 R4 单独点名。
      `.trim(),
    },

    doRunning: {
      title: "do_window (status=running)",
      content: `
status=running 的 do_window 永远合法——等子线程 outbox 回报。
status 为其它值（如归档后的 closed）不算合法候选。
      `.trim(),
    },
  },

  rejectBranches: {
    title: "拒绝分支",
    summary: "handleWaitTool 按顺序检查 5 条分支；任一命中即直接 reject",

    r5NoCandidate: {
      title: "R5 无合法候选",
      content: `
最先检查（先于 R1）：thread.contextWindows 不含任何 open talk / running do →
直接 reject，强 nudge 改 end command。

意图：阻断"任务已做完、想 wait 歇着等下一次召唤"——正确收尾应走 end。
      `.trim(),
    },

    r1MissingOn: {
      title: "R1 on 缺失",
      content: `
on 不是非空字符串 → reject。提示 LLM 必须显式选一个 window id。
      `.trim(),
    },

    r2WindowNotFound: {
      title: "R2 window 不存在",
      content: `
on 在 thread.contextWindows 中查不到 → reject。常见于 LLM 复述旧
window id 或拼写错误。
      `.trim(),
    },

    r3WrongType: {
      title: "R3 类型不符",
      content: `
window 存在但 type 不是 talk / do（root / command_exec / file / knowledge /
search / program / todo）→ reject。这条同时覆盖了所有"非 IO" window 类型，
不用为每种类型写独立分支。
      `.trim(),
    },

    r4SelfBuiltUnsaid: {
      title: "R4 自建 talk 未 say",
      content: `
talk_window 合法但 isCreatorWindow=false 且 thread.outbox 中无对应 windowId
消息 → reject，单独点名提示"先 say 再 wait"。
      `.trim(),
    },
  },

  successEffects: {
    title: "成功副作用",
    summary: "5 条 reject 都不命中时写入 thread 三个字段，scheduler 据此唤醒",

    threadStatus: {
      title: 'thread.status = "waiting"',
      content: `
线程主状态切到 waiting；thinkloop 不再驱动它，直到 scheduler 翻醒。
      `.trim(),
    },

    inboxSnapshot: {
      title: "inboxSnapshotAtWait",
      content: `
记录进入 waiting 那刻 inbox 长度。scheduler tick 比较 inbox.length > snapshot
即翻回 running，并清空 snapshot 与 waitingOn 两个字段。
      `.trim(),
    },

    waitingOn: {
      title: "waitingOn",
      content: `
仅作 observability，让外部能看出该线程在等哪个 window。
不参与 scheduler wakeup 决策——唤醒依据只是 inbox 长度增长。
      `.trim(),
    },
  },

  variantComparison: {
    title: "变体对比",
    summary: "wait / do(wait=true) / talk(wait=true) / end 的语义异同",

    waitTool: {
      title: "wait(on=<id>)",
      content: `
显式调一次 wait tool，waitingOn = 传入的 on。
适合"已经做完一轮动作、决定开始等"的场景。
      `.trim(),
    },

    doWaitFlag: {
      title: "do(args.wait=true) (submit 时)",
      content: `
子线程创建后立即把父切到 waiting；waitingOn = 新建的 do_window.id。
省一次 wait tool 调用。
      `.trim(),
    },

    talkWaitFlag: {
      title: "talk_window.say(wait=true)",
      content: `
发完消息立即把父切到 waiting；waitingOn = 该 talk_window.id。
对端回复进 inbox 即唤醒。
      `.trim(),
    },

    endComparison: {
      title: "与 end 的区别",
      content: `
| Command/Tool | 状态 | 是否还能被唤醒 |
|---|---|---|
| wait (tool) | waiting | 是（任意 inbox 消息） |
| end (command) | done | 是（任意 inbox 消息会翻回 running） |

- wait 表达"我的事情没结束，等待更多消息来推进"——需要有明确"等什么"
- end 表达"本线程任务完结，若有新情况可再来找我"——没有 IO 依赖时的正确收尾

任务做完想"歇会儿"想用 wait → 没合法 on 候选会被 R5 reject，应该走 end。
      `.trim(),
    },
  },
};
