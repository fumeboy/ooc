/**
 * thread —— 会话 object method（say / reply）。
 *
 * thread 是唯一会话载体注册 class（context.md 核心 2/8/9）；同一 thread 按视角投影成统一 default
 * 窗 + super 窗（issue E：原 thread / talk / reflect_request 三投影 → default + super 二投影），
 * 写消息 method 按视角分名（creator-scoped inbox/outbox：inbox=creator→本 thread、outbox=本
 * thread→creator）：
 *   - **say**（self-view 窗：`default` / `super`）—— 本 thread 对其 **creator** 说话 → 写
 *     本 thread 的 **outbox**。
 *   - **reply**（creator-view 也是 `default` 投影，靠单 transcript 模型 + entry.author 区分视角）——
 *     creator 回话进 **child** → 写 child（窗所代表的那条 thread）的 **inbox**。
 *
 * **单一职责**：写盘共享 transcript（self.data.messages push）→ 经 `ctx.runtime.scheduleSession`
 * 唤醒对端 thread 所属 session 的 worker。
 *
 * **对端 sessionId 推断（issue G）**：
 *   - 普通 thread（self.data.callerSessionId === undefined）→ 对端 sessionId === self.data.sessionId
 *     （同 session 内 peer/fork，唤醒自身 session worker 继续推进）。
 *   - super thread（self.data.callerSessionId !== undefined）→ 对端 sessionId === self.data.callerSessionId
 *     （super→业务 session 反向唤醒：reply 回报 caller 业务 worker）。
 *
 * 注：**wait / close 是 tool 原语（非 method）**——见 thinkable/tools/schema.ts。
 */
import type {
  ObjectMethod,
} from "@ooc/core/types";
import type { MethodCallSchema } from "@ooc/core/types";
import { generateMessageId } from "@ooc/builtins/agent/children/thread/executable/utils.js";
import type { Data, ThreadMessage } from "../types.js";

const SAY_SCHEMA: MethodCallSchema = {
    msg: { type: "string", required: true, description: "要发给对端的消息正文" },
  };

// caller(thread creator) say to callee thread
export const sayMethod: ObjectMethod<Data> = {
  name: "say",
  description:
    "Send a message to your creator: write into this thread's outbox and trigger scheduling.",
  schema: SAY_SCHEMA,
  permission: () => "allow",
  exec: async (ctx, self, args) => {
    const msg = {
      id: generateMessageId(),
      createdAt: Date.now(),
      content: args.msg,
      from: "caller",
    } as ThreadMessage;
    self.data.messages.push(msg);
    await ctx.reportDataEdit();
    // 对端 sessionId：super thread → callerSessionId（业务 session 反向唤醒）；
    // 普通 thread → 自身 sessionId（同 session peer/fork 继续推进）。
    const targetSid = self.data.callerSessionId ?? self.data.sessionId;
    ctx.runtime.scheduleSession?.(targetSid);
    return { message: "[say] message delivered" };
  }
};

// thread reply to caller (thread creator)
export const replyMethod: ObjectMethod<Data> = {
  name: "reply",
  description:
    "Reply into the child thread: write into that thread's inbox and trigger scheduling.",
  schema: SAY_SCHEMA,
  permission: () => "allow",
  exec: async (ctx, self, args) => {
    const msg = {
      id: generateMessageId(),
      content: args.msg,
      createdAt: Date.now(),
      from: "callee",
    } as ThreadMessage;
    self.data.messages.push(msg);
    await ctx.reportDataEdit();
    const targetSid = self.data.callerSessionId ?? self.data.sessionId;
    ctx.runtime.scheduleSession?.(targetSid);
    return { message: "[reply] message delivered" };
  }
};
