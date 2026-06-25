/**
 * thread —— ooc class：agent 一次智能运行的载体，也是**唯一**会话载体注册 class。
 *
 * 当前仅持 readable / executable / persistable / unactive 三件套 + 生命周期钩子；
 * thinkable（thinkloop / scheduler / recovery / context / tools）已退役，待重建后再挂上。
 */
import type { OocClass } from "@ooc/core/runtime/ooc-class.js";
import type {
  ConstructorContext,
  ObjectConstructor,
  LifecycleContext,
  ObjectLifecycleHook,
} from "@ooc/core/types";
import type { ThreadContext, ThreadMessage } from "./types.js";
import executable from "./executable/index.js";
import readable from "./readable/index.js";
import persistable from "./persistable/index.js";
import thinkable from "./thinkable/index.js";
import type { Data } from "./types.js";
import { generateMessageId, generateThreadId } from "./executable/utils.js";
import { SelfProxy } from "@ooc/core/runtime/self-proxy.js";

const construct: ObjectConstructor<Data> = {
  description:
    "Construct a new thread (conversation carrier). callerObjectId===calleeObjectId ⇒ fork child; else peer callee.",
  schema: {
    calleeObjectId: { type: "string", required: false, description: "本线程所属对象 id" },
    msg: { type: "string", required: false, description: "message content" },
  },
  exec: async (ctx: ConstructorContext, args: Record<string, unknown>): Promise<Data> => {
    return {
      id: generateThreadId(),
      calleeObjectId: args.calleeObjectId as string,
      sessionId: ctx.sessionId,
      status: "running",
      messages: [
        { id: generateMessageId(), content: args.message as string, from: "caller", createdAt: Date.now() },
      ],
      events: [],
      contextWindows: [
        { id: args.calleeObjectId as string, class: "self", createdAt: Date.now(), closable: false },
        { id: "_builtin/filesystem", class: "_builtin/filesystem", createdAt: Date.now(), closable: false },
        { id: "_builtin/terminal", class: "_builtin/terminal", createdAt: Date.now(), closable: false },
        { id: "_builtin/interpreter", class: "_builtin/interpreter", createdAt: Date.now(), closable: false },
        { id: "_builtin/knowledge_base", class: "_builtin/knowledge_base", createdAt: Date.now(), closable: false },
        { id: "_builtin/runtime", class: "_builtin/runtime", createdAt: Date.now(), closable: false },
        { id: "_builtin/agent/skill_index", class: "_builtin/agent/skill_index", createdAt: Date.now(), closable: false },
      ],
    };
  },
};

// ─────────────────────────── unactive（生命周期：refcount 归 0 触发）───────────────────────────
const unactive: ObjectLifecycleHook<ThreadContext> = {
  description:
    "Notify the dereferenced thread it lost its last subscriber; non-terminal threads receive an inbox notice and self-decide whether to end. No cancel / cascade / forced destruct.",
  exec: async (ctx: LifecycleContext, self: ThreadContext) => {
    if (self.status === "done" || self.status === "failed") return;
    const notice: ThreadMessage = {
      id: generateMessageId(),
      createdAt: Date.now(),
      content: `[系统] caller 已关闭对话窗口，当前 thread 已无消息订阅者；可自行决定是否 end。`,
      from: "caller",
    };
    self.messages.push(notice);
    ctx.reportDataEdit();
  },
};

export const Class: OocClass<Data> = {
  id: "_builtin/agent/thread",
  construct,
  executable,
  readable,
  persistable,
  thinkable,
  unactive,
};

export type { Data } from "./types.js";
export { WindowManager } from "./runtime/window-manager.js";
