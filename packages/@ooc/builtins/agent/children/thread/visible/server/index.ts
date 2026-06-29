/**
 * thread visible/server 模块 (S2, 2026-06-29 落地)。
 *
 * 人类经浏览器 `/api/flows/<sid>/<oid>/call_method` 调本模块的 for-ui method,改 thread
 * 数据(标已读 / 静音 / 重命名等运行态字段),无需经过 thinkloop。
 *
 * **设计权威**: visible/self.md ## 核心设计 + index.md §B ## visible:
 * "ctx 有 world/session/object-self、无 thinkloop thread;改 data → persistable.save 非版本化"。
 *
 * 当前 method 集 (范例,后续按需求扩):
 *   - markRead(args: { messageId? }): 把指定 message (或末尾消息) 标已读 → data.readUpToMessageId
 *   - mute(args: { until?: number }): 暂时静音 thread 通知 → data.mutedUntil (epoch ms)
 *   - unmute(): 清 mutedUntil
 */
import type {
  VisibleServerContext,
  VisibleServerMethod,
  VisibleServerModule,
} from "@ooc/core/types/visible-server.js";
import type { ThreadContext } from "../../types.js";

const markRead: VisibleServerMethod<ThreadContext> = {
  name: "markRead",
  description: "标记 thread 中某 message (默认末尾) 已被人类用户阅读。",
  schema: {
    messageId: { type: "string", description: "目标 message id (缺省取末尾)", required: false },
  },
  exec: async (ctx: VisibleServerContext, self: ThreadContext, args) => {
    const targetId =
      typeof args.messageId === "string"
        ? args.messageId
        : self.messages[self.messages.length - 1]?.id;
    if (!targetId) return { ok: false, error: "no message to mark" };
    // S5 thread types 加 readUpToMessageId; 当前先以 ad-hoc field 落地 (本 issue 落地用,
    // 类型扩展 issue 起新 PR)。
    (self as unknown as { readUpToMessageId?: string }).readUpToMessageId = targetId;
    if (ctx.reportDataEdit) await ctx.reportDataEdit();
    return { ok: true, messageId: targetId };
  },
};

const mute: VisibleServerMethod<ThreadContext> = {
  name: "mute",
  description: "暂时静音 thread 通知 (until 缺省 = 永久)。",
  schema: {
    until: { type: "number", description: "解除静音的 epoch ms (缺省 = 永久静音)", required: false },
  },
  exec: async (ctx: VisibleServerContext, self: ThreadContext, args) => {
    const until = typeof args.until === "number" ? args.until : Number.POSITIVE_INFINITY;
    (self as unknown as { mutedUntil?: number }).mutedUntil = until;
    if (ctx.reportDataEdit) await ctx.reportDataEdit();
    return { ok: true, mutedUntil: until };
  },
};

const unmute: VisibleServerMethod<ThreadContext> = {
  name: "unmute",
  description: "解除 thread 静音。",
  exec: async (ctx: VisibleServerContext, self: ThreadContext) => {
    delete (self as unknown as { mutedUntil?: number }).mutedUntil;
    if (ctx.reportDataEdit) await ctx.reportDataEdit();
    return { ok: true };
  },
};

const visibleServer: VisibleServerModule<ThreadContext> = {
  methods: [markRead, mute, unmute],
};

export default visibleServer;
