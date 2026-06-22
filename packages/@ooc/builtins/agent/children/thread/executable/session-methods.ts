/**
 * thread —— 会话 object method（say）。
 *
 * thread 是唯一会话载体注册 class（context.md 核心 2/8/9）；所有会话窗（creator/peer/sub/fork）
 * 都是 thread 实例。会话 method 归 thread。
 *
 * **say 单一职责**（creator-scoped inbox/outbox 模型）：把消息写进**本 thread 的 box**、经 runtime
 * 触发对端调度，**只做这一件事**：
 *   - 面向 creator 的自身 thread 窗（`isSelfThreadWindow`）→ 出站（我→creator）写 `self.outbox`、
 *     runtime 触发 **creator** 调度。
 *   - 面向 sub/peer 的窗 → 入站写 `self.inbox`、runtime 触发**对端（自己的子线程）**调度。
 *
 * 单一真相源 = `self.data` 的 box（对象/上下文窗拆分落地后，ref 窗的 data 解析到对端 thread）。
 * 对端读侧投影（peer-ref）、callee 创建/首条 say、跨 session 路由、状态机细节均属**后续重构**——
 * 本轮不在 say 内闭合（存量牵扯按计划稍后统一改）。
 *
 * 注：**wait 是 3 原语之一（非 method）**——经 `core/executable/tools/wait.ts` 独立 tool 入口表达。
 * 关窗也是原语（`core/executable/tools/close.ts`）、**不是** thread method。
 */
import type {
  ExecutableContext,
  ObjectMethod,
} from "@ooc/core/executable/contract.js";
import type { MethodCallSchema } from "@ooc/core/_shared/types/intent.js";
import { notifyThreadActivated } from "@ooc/core/observable/index.js";
import { isSelfThreadWindow } from "@ooc/core/_shared/types/context-window.js";
import { makeMessage } from "@ooc/builtins/agent/thread/executable/talk-fork.js";
import type { Data } from "../types.js";

// ─────────────────────────── say ──────────────────────────────

const SAY_SCHEMA: MethodCallSchema = {
  args: {
    msg: { type: "string", required: true, description: "要发给对端的消息正文" },
  },
};

async function executeSay(
  ctx: ExecutableContext,
  self: Data,
  args: Record<string, unknown>,
): Promise<string | undefined> {
  const content = typeof args.msg === "string" ? args.msg : "";
  if (!content.trim()) return "[thread.say] 缺少 msg 参数（消息正文）。";

  const ref = ctx.persistence;
  const partnerThreadId = self.targetThreadId;

  // 1) 构造消息并写进本 thread 的 box（creator-scoped 单一真相源）。
  const message = makeMessage(ref?.threadId ?? "", partnerThreadId ?? "", content);
  message.windowId = ctx.object.id;
  message.fromObjectId = ref?.objectId;

  const toCreator = isSelfThreadWindow(ctx.object.id);
  if (toCreator) {
    self.outbox = [...(self.outbox ?? []), message]; // 我 → creator
  } else {
    self.inbox = [...(self.inbox ?? []), message]; // → 对端（自己的子线程）
  }
  await ctx.reportDataEdit?.();

  // 2) 经 runtime 触发对端（creator 或子线程）调度，由调度器接管 think。
  if (ref && self.target && partnerThreadId) {
    notifyThreadActivated({ sessionId: ref.sessionId, objectId: self.target, threadId: partnerThreadId });
  }

  return `[thread.say] 已写入 ${toCreator ? "outbox" : "inbox"} 并触发对端调度。`;
}

export const sayMethod: ObjectMethod<Data> = {
  name: "say",
  description:
    "Send a message to the peer: write into this thread's inbox/outbox and trigger the peer's scheduling.",
  schema: SAY_SCHEMA,
  permission: () => "allow",
  public: true,
  exec: (ctx, self, args) => executeSay(ctx, self.data, args),
};

export const sessionMethods: ObjectMethod<Data>[] = [sayMethod];
