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
`.trim(),

  creation_v20260517_1: {
    index: `
## creation — 通道建立

caller 通过 \`root.talk\` 创建一个 talk_window，绑定到某个 target flow object，
后续基于该窗口持续对话。
`.trim(),
  },

  commands_v20260517_1: {
    index: `
## commands — talk_window 命令面

talk_window 暴露三条命令，详见子节点。
`.trim(),

    say_v20260517_1: {
      index: `
### say

向 callee 投递一条消息，写入 callee inbox（同时镜像到 caller outbox）。
`.trim(),
    },

    wait_v20260517_1: {
      index: `
### wait

caller 进入 waiting 态，等待 callee 的下一条消息回来唤醒；
具体唤醒条件由 wait 的 on 子语义决定（详见 executable.windows.talkWindow）。
`.trim(),
    },

    close_v20260517_1: {
      index: `
### close

关闭 talk_window；后续无法 say / wait，但已落盘消息保留。
`.trim(),
    },
  },

  delivery_v20260517_1: {
    index: `
## delivery — talk-delivery 派送

talk-delivery 模块在 say 触发时负责四步串行操作，详见子节点。
`.trim(),

    resolveCallee_v20260517_1: {
      index: `
### 解析或创建 callee thread

按 callee object id 解析其当前 root thread；不存在则创建。
`.trim(),
    },

    doubleWrite_v20260517_1: {
      index: `
### 双写 outbox / inbox

caller outbox + callee inbox 同步追加同一条 message 记录。
`.trim(),
    },

    statusFlip_v20260517_1: {
      index: `
### 状态翻转

callee 若处于 waiting / done / failed，翻回 running 让 scheduler 派 worker 接手。
`.trim(),
    },
  },

  scopeNote_v20260517_1: {
    index: `
## scopeNote — 本概念与 talkWindow 的分工

具体命令面与窗口语义在 \`executable.windows.talkWindow\` 概念中表达；
本概念聚焦"talk 作为合作基础"的协作语义视角，不重复命令字段细节。
`.trim(),
  },
};
