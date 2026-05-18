import type { Concept, DocNode } from "@meta/doc-types";
import { collaborable_v20260504_1 } from "@meta/object/collaborable/index.doc";
import * as talkWindow from "@src/executable/windows/talk";
import * as talkDelivery from "@src/executable/windows/talk-delivery";
import * as rootTalk from "@src/executable/windows/root/talk";

/* ────────────────────────────────────────────────────────────────
 *  目录页：Talk 概念全貌
 * ──────────────────────────────────────────────────────────────── */

/**
 * Talk 概念：Object 之间的一对一持续会话原语。
 *
 * sources:
 *  - talkWindow    — talk_window type 与其 say / wait / close 命令面
 *  - talkDelivery  — 跨对象消息派送：解析 caller/callee、双写 outbox/inbox、状态翻转
 *  - rootTalk      — root.talk command：创建一个新的 talk_window
 */
export type TalkConcept = Concept & {
  sources: {
    talkWindow: typeof talkWindow;
    talkDelivery: typeof talkDelivery;
    rootTalk: typeof rootTalk;
  };

  /** root.talk 如何创建 talk_window */
  creation: {
    title: string;
    summary?: string;
    rootTalkCommand: DocNode;
    targetBinding: DocNode;
    windowPersistence: DocNode;
  };

  /** talk_window 上的 say / wait / close 三条命令 */
  commands: {
    title: string;
    summary?: string;
    say: DocNode;
    wait: {
      title: string;
      summary?: string;
      content?: string;
      waitingState: DocNode;
      waitOnSubsemantics: DocNode;
    };
    close: {
      title: string;
      summary?: string;
      content?: string;
      noPostCloseOps: DocNode;
      messagesPreserved: DocNode;
    };
  };

  /** talk-delivery 模块负责的派送步骤 */
  delivery: {
    title: string;
    summary?: string;
    resolveCallee: DocNode;
    doubleWrite: DocNode;
    statusFlip: DocNode;
  };

  /** 本概念与 executable.windows.talkWindow 的分工 */
  scopeNote: DocNode;
};

/* ────────────────────────────────────────────────────────────────
 *  数据填充
 * ──────────────────────────────────────────────────────────────── */

export const talk_v20260506_1: TalkConcept = {
  name: "Talk",
  get parent() {
    return collaborable_v20260504_1;
  },
  sources: { talkWindow, talkDelivery, rootTalk },
  description: `
Talk 是 Object 之间一对一的持续会话原语。caller 通过 root.talk 创建 talk_window，
后续通过 say / wait / close 三条命令维持对话；底层由 talk-delivery 模块完成
inbox / outbox 的同步与 callee 状态翻转。
`.trim(),

  creation: {
    title: "creation",
    summary: "root.talk 创建 talk_window，绑定到某个 target flow object",

    rootTalkCommand: {
      title: "root.talk command",
      content: `
入口是 root window 上的 talk command。每次 \`open(command="talk", args={target})\`
都创建一个新的 talk_window（多次调用 → 多个独立窗口）。
      `.trim(),
    },

    targetBinding: {
      title: "target 绑定",
      content: `
新 window 绑定到 target flow object 的 root thread——若 target flow 不存在则
按需创建。绑定后 caller 与 callee 通过这一对 thread + window 进行后续对话。
      `.trim(),
    },

    windowPersistence: {
      title: "window 持久性",
      content: `
window 在 thread 持久化范围内长期存在，直到显式 close。重启 server 后
window 状态从 thread.json 恢复，不丢失。
      `.trim(),
    },
  },

  commands: {
    title: "commands",
    summary: "talk_window 暴露 say / wait / close 三条命令",

    say: {
      title: "say",
      content: "向 callee 投递一条消息，写入 callee inbox（同时镜像到 caller outbox）。",
    },

    wait: {
      title: "wait",
      summary: "caller 进入 waiting 态，等待 callee 的下一条消息回来唤醒",

      waitingState: {
        title: "waiting 状态语义",
        content: `
线程 status 翻为 waiting，scheduler 不再调度该线程进入下一轮 ThinkLoop。
inbox 出现匹配新消息时翻回 running 触发唤醒。
        `.trim(),
      },

      waitOnSubsemantics: {
        title: "on 子语义",
        content: `
具体唤醒条件由 wait 的 \`on\` 子语义决定（详见 executable.windows.talkWindow）。
\`on\` 决定"哪种 inbox 事件算唤醒"——避免无关消息误唤醒。
        `.trim(),
      },
    },

    close: {
      title: "close",
      summary: "关闭 talk_window；后续无法 say / wait，但已落盘消息保留",

      noPostCloseOps: {
        title: "关闭后命令面失效",
        content: `
close 后再调 say / wait 会返回 error——不重新打开 window，需要新建一个 window。
        `.trim(),
      },

      messagesPreserved: {
        title: "消息历史保留",
        content: `
inbox / outbox 中已写入的消息保留，可在 transcript 中继续被引用。
close 不删除历史，只关闭通道。
        `.trim(),
      },
    },
  },

  delivery: {
    title: "delivery",
    summary: "talk-delivery 模块在 say 触发时负责四步串行操作",

    resolveCallee: {
      title: "解析或创建 callee thread",
      content: `
按 callee object id 解析其当前 root thread；不存在则创建。

**target='super' 自指别名**（spec 2026-05-18 super-flow-channel）：
\`callerWindow.target === "super"\` 时翻译为 \`calleeObjectId = caller.objectId\`
+ \`calleeSessionId = "super"\`——派送到 caller 自己的 super 分身（详见
\`reflectable.invocation.selfAlias\`）。这是 talk-delivery 第一处跨 session
派送场景；其它 target 保持同 session 行为。
      `.trim(),
    },

    doubleWrite: {
      title: "双写 outbox / inbox",
      content: "caller outbox + callee inbox 同步追加同一条 message 记录。",
    },

    statusFlip: {
      title: "状态翻转",
      content: `
callee 若处于 waiting / done / failed，翻回 running 让 scheduler 派 worker 接手。
      `.trim(),
    },
  },

  scopeNote: {
    title: "scopeNote",
    summary: "本概念聚焦协作语义，命令面细节在 executable.windows.talkWindow",
    content: `
具体命令面与窗口语义在 \`executable.windows.talkWindow\` 概念中表达；
本概念聚焦"talk 作为合作基础"的协作语义视角，不重复命令字段细节。

talk 跨对象的可识别性由 \`thinkable.identity\` 提供：caller / callee 各自的
self.md 通过 instructions 通道进入 LLM，渲染 \`<self object_id="…">\` 标记，
使多 Object 在同一 Session 中持有可区分的身份。
    `.trim(),
  },
};
