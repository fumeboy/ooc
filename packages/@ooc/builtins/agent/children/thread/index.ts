/**
 * thread —— ooc class：agent 一次智能运行的载体，也是**唯一**会话载体注册 class。
*/
import type { OocClass } from "@ooc/core/runtime/ooc-class.js";
import type {
  ConstructorContext,
  ObjectConstructor,
  LifecycleContext,
  ObjectLifecycleHook,
} from "@ooc/core/executable/contract.js";
import type { MethodCallSchema } from "@ooc/core/_shared/types/intent.js";
import type { ThreadContext, ThreadMessage } from "@ooc/builtins/agent/thread/types.js";
import executable from "./executable/index.js";
import readable from "./readable/index.js";
import thinkable from "./thinkable/index.js";
import persistable from "./persistable/index.js";
import type { Data } from "./types.js";
import { generateMessageId, generateThreadId } from "./executable/utils.js";
import { SelfProxy } from "@src/runtime/self-proxy.js";

const construct: ObjectConstructor<Data> = {
  description:
    "Construct a new thread (conversation carrier). callerObjectId===calleeObjectId ⇒ fork child; else peer callee.",
  schema: {
    args: {
      calleeObjectId: { type: "string", required: false, description: "本线程所属对象 id" },
      msg: { type: "string", required: false, description: "message content" },
    },
  } as MethodCallSchema,
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
    }
  },
};

// ─────────────────────────── unactive（生命周期：refcount 归 0 触发）───────────────────────────
const unactive: ObjectLifecycleHook = {
  description:
    "Notify the dereferenced thread (received as self) it lost its last subscriber; non-terminal threads receive an inbox notice and self-decide whether to end. No cancel / cascade / forced destruct.",
  exec: async (ctx: LifecycleContext, self: SelfProxy<ThreadContext>) => {
    if (self.data.status === "done") return;
    const notice: ThreadMessage = {
      id: generateMessageId(),
      createdAt: Date.now(),
      content: `[系统] caller 已关闭对话窗口，当前 thread 已无消息订阅者；可自行决定是否 end。`,
      from: "caller",
    };
    self.data.messages.push(notice);
    ctx.reportDataEdit();
  },
};

export const Class: OocClass<Data> = {
  construct,
  executable,
  readable,
  thinkable,
  persistable,
  unactive,
};

export type { Data } from "./types.js";
