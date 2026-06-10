/**
 * root.talk command — 委托到 talk_window constructor。
 */

import type { ObjectMethod } from "@ooc/core/extendable/_shared/method-types.js";
import { makeRootDelegator } from "@ooc/builtins/_shared/executable/delegator.js";
import type { MethodExecWindow } from "@ooc/core/executable/windows/method_exec/types.js";

import "@ooc/core/executable/windows/talk/index.js";

const TALK_TIP = `talk 开启一个对外的持续会话 talk_window（同一 target 复用同一 talk_window，不要每条消息重开）。
参数：target（必填，目标 objectId，"user" 也是）、title（必填，会话主题）。`;

export enum TalkMethodPath {
  Talk = "talk",
}

export const talkMethod: ObjectMethod = {
  description: "Open a persistent talk_window to another flow object (or user).",
  intents: [TalkMethodPath.Talk],
  schema: {
    args: {
      target: { type: "string", required: true, description: "目标 flow object 的 objectId" },
      title: { type: "string", required: true, description: "本会话的简短主题" },
    },
  },
  onFormChange(change, { form }) {
    const args = (form as MethodExecWindow).accumulatedArgs;
    const target = typeof args.target === "string" ? args.target.trim() : "";
    const title = typeof args.title === "string" ? args.title.trim() : "";
    const ready = Boolean(target && title);
    return {
      tip: ready ? `Opening talk to ${target}...` : TALK_TIP,
      intents: [{ name: "talk" }],
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
