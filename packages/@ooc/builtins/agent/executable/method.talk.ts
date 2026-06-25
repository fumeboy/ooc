/**
 * agent.talk —— agent agency 核心 method：开启一条 thread 对话。
 *
 * 行为：经 `ctx.runtime.instantiate({class: "_builtin/agent/thread", args:{...}})` 造一条 thread
 * 实例。thread.construct 据 callerObjectId / calleeObjectId / msg 初始化：
 *   - target = 别的 objectId ⇒ peer 跨对象会话
 *   - target = 自己的 objectId ⇒ fork 同对象子线程
 *
 * 返回新 thread 的 ref。
 */
import type { ExecutableContext, ObjectMethod } from "@ooc/core/types/index.js";
import { THREAD_CLASS_ID } from "@ooc/core/types/constants.js";
import type { Data } from "../types.js";

export const talkMethod: ObjectMethod<Data> = {
  name: "talk",
  description:
    "Start a new thread (conversation) with a target object. target=other objectId ⇒ peer; target=self ⇒ fork. Returns the thread ref.",
  schema: {
    target: { type: "string", required: true, description: "对端 objectId（或自己 ⇒ fork 子线程）" },
    msg: { type: "string", required: false, description: "首条消息（可选）" },
    title: { type: "string", required: false, description: "会话标题（peer 推荐）" },
  },
  public: true,
  permission: () => "allow",
  exec: async (ctx: ExecutableContext, _self, args: Record<string, unknown>) => {
    const target = typeof args.target === "string" ? args.target : "";
    if (!target) return { err: "[talk] missing target" };
    const msg = typeof args.msg === "string" ? args.msg : undefined;

    const ref = await ctx.runtime.instantiate({
      class: THREAD_CLASS_ID,
      args: { calleeObjectId: target, message: msg },
    });
    return {
      message: `[talk] thread ${ref.id} opened with ${target}`,
      refs: [ref],
    };
  },
};
