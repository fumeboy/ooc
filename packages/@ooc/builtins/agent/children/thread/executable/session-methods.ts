/**
 * thread —— 会话 object method（say / reply）。
 *
 * thread 是唯一会话载体注册 class（context.md 核心 2/8/9）；同一 thread 按视角投影成两种会话窗，
 * 各自的写消息 method 按视角分名（creator-scoped inbox/outbox：inbox=creator→本 thread、
 * outbox=本 thread→creator）：
 *   - **say**（self-view 窗：`thread` / `reflect_request`）—— 本 thread 对其 **creator** 说话 → 写
 *     本 thread 的 **outbox**。
 *   - **reply**（creator-view 窗：`talk`，即 creator 看 child 的会话窗）—— creator 回话进 **child** →
 *     写 child（窗所代表的那条 thread）的 **inbox**。
 *
 * **单一职责**：只把消息写进 thread Data 的 box（`self.data` 活引用）+ 经 runtime 触发对端调度。
 * runtime 调度本轮留 `TODO()` 占位（enqueueThread 待建，issue 后续点）；跨 thread 真实 delivery /
 * 对端读侧 peer-ref 投影 / callee 创建 / 跨 session 路由均属后续重构，不在此闭合。
 *
 * 注：**wait / close 是 tool 原语（非 method）**——见 `core/executable/tools/{wait,close}.ts`。
 */
import type {
  ExecutableContext,
  ObjectMethod,
} from "@ooc/core/executable/contract.js";
import type { MethodCallSchema } from "@ooc/core/_shared/types/intent.js";
import { TODO } from "@ooc/core/_shared/utils/todo.js";
import { makeMessage } from "@ooc/builtins/agent/thread/executable/talk-fork.js";
import type { Data } from "../types.js";

const SAY_SCHEMA: MethodCallSchema = {
  args: {
    msg: { type: "string", required: true, description: "要发给对端的消息正文" },
  },
};

/**
 * 把 args.msg 包成 ThreadMessage 写进本 thread 的指定 box（self.data 活引用，随默认 data.json 落盘），
 * 再经 runtime 触发对端调度。两个 method（say→outbox / reply→inbox）共用此体。
 */
async function writeBoxAndSchedule(
  ctx: ExecutableContext,
  self: Data,
  args: Record<string, unknown>,
  box: "inbox" | "outbox",
): Promise<string | undefined> {
  const content = typeof args.msg === "string" ? args.msg : "";
  if (!content.trim()) {
    return `[thread.${box === "outbox" ? "say" : "reply"}] 缺少 msg 参数（消息正文）。`;
  }

  const message = makeMessage(ctx.persistence?.threadId ?? "", self.targetThreadId ?? "", content);
  message.windowId = ctx.object.id;
  message.fromObjectId = ctx.persistence?.objectId;
  self[box] = [...(self[box] ?? []), message];
  await ctx.reportDataEdit?.();

  return triggerRuntimeSchedule(ctx, self);
}

/**
 * TODO(thread-say-schedule)：say/reply 写盘后经 runtime 触发对端调度
 * （say→本 thread 的 creator / reply→窗所代表的 child 子线程）。
 * enqueueThread 机制待建（thread-core-boundary issue 后续点），本轮留 TODO 占位。
 */
function triggerRuntimeSchedule(_ctx: ExecutableContext, _self: Data): never {
  return TODO("runtime 触发 say/reply 对端调度（enqueueThread 待建）");
}

/** self-view 窗（thread / reflect_request）：本 thread → creator，写 outbox。 */
export const sayMethod: ObjectMethod<Data> = {
  name: "say",
  description:
    "Send a message to your creator: write into this thread's outbox and trigger scheduling.",
  schema: SAY_SCHEMA,
  permission: () => "allow",
  public: true,
  exec: (ctx, self, args) => writeBoxAndSchedule(ctx, self.data, args, "outbox"),
};

/** creator-view 窗（talk）：creator → child，写 child（窗所代表 thread）的 inbox。 */
export const replyMethod: ObjectMethod<Data> = {
  name: "reply",
  description:
    "Reply into the child thread: write into that thread's inbox and trigger scheduling.",
  schema: SAY_SCHEMA,
  permission: () => "allow",
  public: true,
  exec: (ctx, self, args) => writeBoxAndSchedule(ctx, self.data, args, "inbox"),
};

export const sessionMethods: ObjectMethod<Data>[] = [sayMethod, replyMethod];
