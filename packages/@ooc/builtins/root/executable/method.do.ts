/**
 * root.do method — 委托到 do_window constructor。
 */

import type { ObjectMethod } from "@ooc/core/extendable/_shared/method-types.js";
import { makeRootDelegator } from "@ooc/builtins/_shared/executable/delegator.js";

import "@ooc/core/executable/windows/do/index.js";

const DO_TIP = `do 在当前对象内派生子线程，父线程下挂 do_window。
参数：msg（必填，子线程初始消息）、wait（可选，true 时父线程等待子线程回写）、share_windows（可选，初始分享的 windows）。`;

export enum DoMethodPath {
  Do = "do",
  Wait = "do.wait",
}

export const doMethod: ObjectMethod = {
  description: "Fork a child thread with an initial message; produces a do_window for interaction.",
  intents: [DoMethodPath.Wait],
  schema: {
    args: {
      msg: { type: "string", required: true, description: "写入子线程 inbox 的初始消息" },
      wait: { type: "boolean", required: false, description: "true 时父线程立刻进入 waiting，等子线程回写消息再唤醒" },
      share_windows: { type: "array", required: false, description: "要在子线程创建时一并分享的 windows 列表" },
    },
  },
  onFormChange(change, { args }) {
    const intents = args.wait === true ? [{ name: DoMethodPath.Wait }] : [{ name: DoMethodPath.Do }];
    const hasMsg = typeof args.msg === "string" && args.msg.trim().length > 0;
    return {
      tip: hasMsg ? "Forking child thread..." : DO_TIP + "\n\n需要 args.msg（给子线程的初始消息）。",
      intents,
      quick_exec_submit: hasMsg,
    };
  },
  exec: (ctx) => executeDoMethod(ctx),
};

export const executeDoMethod = makeRootDelegator({
  method: "do",
  constructorKind: "do",
  objectLabel: "do_window",
});
