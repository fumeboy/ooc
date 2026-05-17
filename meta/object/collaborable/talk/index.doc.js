import * as talkWindow from "@src/executable/windows/talk";
import * as talkDelivery from "@src/executable/windows/talk-delivery";
import * as rootTalk from "@src/executable/windows/root/talk";
import { collaborable_v20260504_1 } from "@meta/object/collaborable/index.doc";

/**
 * Talk 概念：Object 之间的一对一持续会话原语。
 *
 * sources:
 *  - talkWindow    — talk_window type 与其 say / wait / close 命令面
 *  - talkDelivery  — 跨对象消息派送：解析 caller/callee、双写 outbox/inbox、状态翻转
 *  - rootTalk      — root.talk command：创建一个新的 talk_window
 */
export const talk_v20260506_1 = {
  name: "Talk",
  get parent() { return collaborable_v20260504_1; },
  sources: {
    talkWindow,
    talkDelivery,
    rootTalk,
  },
  description: `
Talk 是 Object 之间一对一的持续会话原语。按子字段展开：

- creation — root.talk 如何创建 talk_window
- commands — talk_window 上的 say / wait / close 三条命令
- delivery — talk-delivery 模块负责的派送步骤
- scopeNote — 本概念与 executable.windows.talkWindow 的分工
`,

  creation: {
    title: "creation",
    content: `
caller 通过 root.talk 创建一个 talk_window，绑定到某个 target flow object，
后续基于该窗口持续对话。详见三个子节点。
    `,

    rootTalkCommand: {
      title: "root.talk command",
      content: `
入口是 root window 上的 talk command。每次 open(command="talk", args={target})
都创建一个新的 talk_window（多次调用 → 多个独立窗口）。
      `,
    },

    targetBinding: {
      title: "target 绑定",
      content: `
新 window 绑定到 target flow object 的 root thread——若 target flow 不存在则
按需创建。绑定后 caller 与 callee 通过这一对 thread + window 进行后续对话。
      `,
    },

    windowPersistence: {
      title: "window 持久性",
      content: `
window 在 thread 持久化范围内长期存在，直到显式 close。重启 server 后
window 状态从 thread.json 恢复，不丢失。
      `,
    },
  },

  commands: {
    title: "commands",
    content: `
talk_window 暴露三条命令，详见子节点。
    `,

    say: {
      title: "say",
      content: `
向 callee 投递一条消息，写入 callee inbox（同时镜像到 caller outbox）。
      `,
    },

    wait: {
      title: "wait",
      content: `
caller 进入 waiting 态，等待 callee 的下一条消息回来唤醒。详见两个子节点。
      `,

      waitingState: {
        title: "waiting 状态语义",
        content: `
线程 status 翻为 waiting，scheduler 不再调度该线程进入下一轮 ThinkLoop。
inbox 出现匹配新消息时翻回 running 触发唤醒。
        `,
      },

      waitOnSubsemantics: {
        title: "on 子语义",
        content: `
具体唤醒条件由 wait 的 on 子语义决定（详见 executable.windows.talkWindow）。
on 决定"哪种 inbox 事件算唤醒"——避免无关消息误唤醒。
        `,
      },
    },

    close: {
      title: "close",
      content: `
关闭 talk_window；后续无法 say / wait，但已落盘消息保留。详见两个子节点。
      `,

      noPostCloseOps: {
        title: "关闭后命令面失效",
        content: `
close 后再调 say / wait 会返回 error——不重新打开 window，需要新建一个 window。
        `,
      },

      messagesPreserved: {
        title: "消息历史保留",
        content: `
inbox / outbox 中已写入的消息保留，可在 transcript 中继续被引用。
close 不删除历史，只关闭通道。
        `,
      },
    },
  },

  delivery: {
    title: "delivery",
    content: `
talk-delivery 模块在 say 触发时负责四步串行操作，详见子节点。
    `,

    resolveCallee: {
      title: "解析或创建 callee thread",
      content: `
按 callee object id 解析其当前 root thread；不存在则创建。
      `,
    },

    doubleWrite: {
      title: "双写 outbox / inbox",
      content: `
caller outbox + callee inbox 同步追加同一条 message 记录。
      `,
    },

    statusFlip: {
      title: "状态翻转",
      content: `
callee 若处于 waiting / done / failed，翻回 running 让 scheduler 派 worker 接手。
      `,
    },
  },

  scopeNote: {
    title: "scopeNote",
    content: `
具体命令面与窗口语义在 executable.windows.talkWindow 概念中表达；
本概念聚焦"talk 作为合作基础"的协作语义视角，不重复命令字段细节。
    `,
  },
};
