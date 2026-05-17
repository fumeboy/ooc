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
Talk 是 Object 之间一对一的持续会话原语。

caller 通过 root.talk 创建一个 talk_window，与某个 target flow object 持续对话。
talk_window 暴露 say / wait / close 三条命令；消息派送由 talk-delivery 统一执行，
负责解析或创建 callee thread、双写 caller.outbox 与 callee.inbox、把 callee
从 waiting/done/failed 翻回 running 让 worker 接手。

具体命令面与窗口语义在 executable.windows.talkWindow 概念中表达；
本概念聚焦"talk 作为合作基础"的协作语义视角。
`.trim(),
};
