import type { Concept, DocNode } from "@meta/doc-types";
import { commands_v20260506_1 } from "@meta/object/executable/actions/commands/index.doc";
import * as doSource from "@src/executable/windows/root/do";

/* ────────────────────────────────────────────────────────────────
 *  目录页：root.do command 的全貌
 * ──────────────────────────────────────────────────────────────── */

/**
 * Do 概念：在当前对象内派生子线程的 root command。
 *
 * sources:
 *  - do — root.do command 实现
 */
export type DoConcept = Concept & {
  sources: { do: typeof doSource };

  /** 调用形态与参数 */
  callShape: DocNode;

  /** submit 触发的 5 项副作用 */
  submitEffects: {
    title: string;
    summary?: string;
    createChildThread: DocNode;
    creatorDoWindow: DocNode;
    initialMessageDelivery: DocNode;
    parentDoWindow: DocNode;
    optionalWait: DocNode;
  };

  /** do_window 上注册的 continue / wait / close */
  doWindowCommands: {
    title: string;
    summary?: string;
    continueCmd: DocNode;
    waitCmd: DocNode;
    closeCmd: DocNode;
  };

  /** root.do 与 do_window 的 command path 列表 */
  pathList: {
    title: string;
    summary?: string;
    rootDoPaths: DocNode;
    doWindowPaths: DocNode;
  };

  /** 子线程上下文继承的当前实现状态 */
  contextInheritance: DocNode;
};

/* ────────────────────────────────────────────────────────────────
 *  数据填充
 * ──────────────────────────────────────────────────────────────── */

export const do_v20260514_1: DoConcept = {
  name: "Do",
  get parent() {
    return commands_v20260506_1;
  },
  sources: { do: doSource },
  description: `
do 在当前对象内派生子线程，submit 后产出一个 **do_window** 挂在父 thread 的
contextWindows 下。

与 talk 的对偶关系：
- do  操作**当前对象（自己）**的线程
- talk 操作**其他对象**的线程（当前仅支持 talk to user）
`.trim(),

  callShape: {
    title: "调用形态",
    summary: "open(command=\"do\", args={ msg, wait? })",
    content: `
\`\`\`
open(command="do", title="处理告警", args={
  msg: "...",        // 必填，写入子线程 inbox 的初始消息
  wait?: true|false  // 可选，true 则父线程立即 status=waiting
})
\`\`\`

参数语义：
- args.msg 必填，作为子线程 inbox 第一条消息
- args.wait 可选，true 时父线程在 submit 后立即进入 waiting
- 不接 context / threadId / knowledge 等额外字段——continue / 知识挂载分别走
  do_window.continue 与 knowledge 体系
    `.trim(),
  },

  submitEffects: {
    title: "submit 副作用",
    summary: "5 项副作用顺序执行，任一失败应整体回滚",

    createChildThread: {
      title: "1. 创建 child thread",
      content: "分配 thread id、派生 persistence ref。",
    },

    creatorDoWindow: {
      title: "2. child 挂 creator do_window",
      content: `
在 child.contextWindows 下挂指向父的初始 creator do_window，
不可被 LLM close（由 onClose hook 拒绝）。
      `.trim(),
    },

    initialMessageDelivery: {
      title: "3. 初始消息投递",
      content: `
- 写消息到 child.inbox
- 写镜像消息到父.outbox
- child 记录一条 inbox_message_arrived 事件
      `.trim(),
    },

    parentDoWindow: {
      title: "4. 父挂 do_window",
      content: `
在父.contextWindows 下挂一个 do_window，targetThreadId=childId，
作为父对该子线程的句柄。
      `.trim(),
    },

    optionalWait: {
      title: "5. wait=true → 父进入 waiting",
      content: `
args.wait === true 时父线程立即 status="waiting"；
scheduler 见父 inbox 增长后唤醒。
      `.trim(),
    },
  },

  doWindowCommands: {
    title: "do_window 子命令",
    summary: "do_window 上注册的 3 个 sub-command",

    continueCmd: {
      title: "continue (args: msg, wait?)",
      content: `
向子线程追加一条消息；wait=true 同样使父进入 waiting。

\`\`\`
open(parent_window_id="<do_window_id>", command="continue",
     title="追加任务", args={ msg: "再处理一批", wait: true })
\`\`\`
      `.trim(),
    },

    waitCmd: {
      title: "wait",
      content: "不发新消息，仅让父进入 waiting 等子线程后续 outbox。",
    },

    closeCmd: {
      title: "close",
      content: "归档子线程对话（B=ii archive）；子线程不再继续 think，历史保留。",
    },
  },

  pathList: {
    title: "command path",
    summary: "root.do 与 do_window 各自注册的 path 列表",

    rootDoPaths: {
      title: "root.do",
      content: `
\`\`\`
do
do.wait
\`\`\`
      `.trim(),
    },

    doWindowPaths: {
      title: "do_window",
      content: `
\`\`\`
continue
continue.wait
wait
close
\`\`\`
      `.trim(),
    },
  },

  contextInheritance: {
    title: "上下文继承",
    summary: "子线程父链 knowledge 继承尚未实现；以 creator do_window 作锚点",
    content: `
设计目标上，子线程可以继承父线程知识；当前 thinkable/knowledge 没有实现父链
knowledge 自动继承。

已实现：子线程一经创建就自带"指向父 thread 的初始 creator do_window"作为锚点，
作为子线程与父线程对话的统一句柄。
    `.trim(),
  },
};
