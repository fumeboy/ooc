import * as talk from "@src/executable/windows/talk";
import * as talkDelivery from "@src/executable/windows/talk-delivery";

/**
 * talk_window 概念：与一个对端 flow object 的持续会话窗口。
 *
 * sources:
 *  - talk         — say / wait / close 命令注册 + onClose hook + basicKnowledge
 *  - talkDelivery — deliverTalkMessage：跨对象消息派送、callee thread 创建
 */
export const talk_window_v20260515_1 = {
  name: "TalkWindow",
  description: `
talk_window 是与一个对端 flow object（含 "user"）的持续会话窗口。

它注册的 command 不在 root 上，要通过
\`open(parent_window_id="<talk_window_id>", command="...", args={...})\` 调用：

| command | 作用 |
|---------|------|
| say     | 发一条消息给对端，并可选地把本线程切到 waiting |
| wait    | 不发消息、仅切到 waiting 等下一条 inbox |
| close   | 结束本对话主题 |

关键约束：
- 不接受 root 级别的 \`talk\` command（root.talk 用来"创建 talk_window"，不是发消息）
- 同一个对端复用同一个 talk_window，不要每发一条消息就 close 再重开
- creator talk_window（isCreatorWindow=true）= 创建本 thread 的对端给你的回信通道；
  收到 inbox 消息后回复就走它的 \`say\`，不要 open 新的 talk

跨对象派送：talk_window.say 内部调 deliverTalkMessage，会按 target objectId 创建 callee
thread（首次）或定位已有 thread，然后把消息双写 caller.outbox + callee.inbox。
`.trim(),
  sources: { talk, talkDelivery },
};
