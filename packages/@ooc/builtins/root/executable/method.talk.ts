/**
 * root.talk command — 委托到 talk_window constructor。
 */

import type { ObjectMethod } from "@ooc/core/extendable/_shared/method-types.js";
import { makeRootDelegator } from "@ooc/builtins/_shared/executable/delegator.js";

import "@ooc/core/executable/windows/talk/index.js";

const TALK_TIP = `talk 开启一个持续会话 talk_window。
- target=别的 objectId（"user" 也是）⇒ peer 跨对象会话（需 title；同一 target 复用同一窗，别每条消息重开）。
- target=自己的 objectId ⇒ fork 一条同对象子线程（需 msg；wait / share_windows 可选）。`;

export enum TalkMethodPath {
  Talk = "talk",
  Wait = "talk.wait",
}

export const talkMethod: ObjectMethod = {
  description: "Open a talk_window: target=another object ⇒ peer conversation; target=self ⇒ fork a child thread.",
  intents: [TalkMethodPath.Talk, TalkMethodPath.Wait],
  schema: {
    args: {
      target: { type: "string", required: true, description: '目标 objectId（别的对象 / "user" ⇒ peer；自己 ⇒ fork 子线程）' },
      title: { type: "string", required: false, description: "peer 会话主题（peer 形态必填）" },
      msg: { type: "string", required: false, description: "fork 子线程初始消息（fork 形态必填）" },
      wait: { type: "boolean", required: false, description: "（fork）true 时父线程等待子线程回写" },
      share_windows: { type: "array", required: false, description: "（fork）随子线程一并传的 windows 列表" },
    },
  },
  onFormChange(change, { args }) {
    const target = typeof args.target === "string" ? args.target.trim() : "";
    const hasTitle = typeof args.title === "string" && args.title.trim().length > 0;
    const hasMsg = typeof args.msg === "string" && args.msg.trim().length > 0;
    const ready = Boolean(target) && (hasTitle || hasMsg);
    const intents = args.wait === true ? [{ name: TalkMethodPath.Wait }] : [{ name: TalkMethodPath.Talk }];
    return {
      tip: ready ? `Opening talk to ${target}...` : TALK_TIP,
      intents,
      quick_exec_submit: ready,
    };
  },
  exec: (ctx) => executeTalkMethod(ctx),
};

export const executeTalkMethod = makeRootDelegator({
  method: "talk",
  constructorKind: "talk",
  objectLabel: "talk_window",
});
