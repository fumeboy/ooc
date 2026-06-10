/**
 * root.open_feishu_chat — 创建 feishu_chat_window。
 */

import type {
  MethodExecutionContext,
  ObjectMethod,
} from "../../../executable/windows/_shared/method-types.js";
import {
  ROOT_WINDOW_ID,
  generateWindowId,
  type FeishuChatWindow,
} from "../../../executable/windows/_shared/types.js";
import type { WindowManager } from "../../../executable/windows/_shared/manager.js";

const OPEN_TIP = `open_feishu_chat 创建飞书群聊/单聊 window。
参数：chat_id（必填 oc_xxx）、chat_name（可选）、chat_type（可选 group/p2p/topic）、tail_count（可选）。
创建后建议立即 refresh 验证拉取链路。`;

export const openFeishuChatMethod: ObjectMethod = {
  description: "Open a Feishu (Lark) chat as a window in context.",
  intents: ["open_feishu_chat"],
  schema: {
    args: {
      chat_id: { type: "string", required: true, description: "飞书 chat_id (oc_xxx)" },
      chat_name: { type: "string", description: "群名/对方姓名" },
      chat_type: { type: "string", enum: ["group", "p2p", "topic"] },
      tail_count: { type: "number", description: "首屏 buffer 条数（默认 30）" },
    },
  },
  onFormChange(change, { args }) {
    const hasChatId = typeof args.chat_id === "string" && args.chat_id.length > 0;
    return {
      tip: hasChatId ? `Opening chat ${args.chat_id}...` : OPEN_TIP,
      intents: [{ name: "open_feishu_chat" }],
      quick_exec_submit: hasChatId,
    };
  },
  exec: (ctx) => executeOpenFeishuChat(ctx),
};

export async function executeOpenFeishuChat(
  ctx: MethodExecutionContext,
): Promise<string | undefined> {
  const thread = ctx.thread;
  if (!thread) return "[open_feishu_chat] 缺少 thread context。";
  const chatId = typeof ctx.args.chat_id === "string" ? ctx.args.chat_id : "";
  if (!chatId) return "[open_feishu_chat] 缺少 chat_id。";
  const chatName =
    typeof ctx.args.chat_name === "string" && ctx.args.chat_name
      ? ctx.args.chat_name
      : chatId.slice(-8);
  const chatType =
    ctx.args.chat_type === "group" || ctx.args.chat_type === "p2p" || ctx.args.chat_type === "topic"
      ? (ctx.args.chat_type as "group" | "p2p" | "topic")
      : undefined;
  const rawCount = Number(ctx.args.tail_count);
  const tailCount = Number.isFinite(rawCount) && rawCount > 0 ? Math.min(Math.max(Math.floor(rawCount), 1), 100) : 30;

  const window: FeishuChatWindow = {
    id: generateWindowId("feishu_chat"),
    type: "feishu_chat",
    parentWindowId: ROOT_WINDOW_ID,
    title: chatName,
    status: "open",
    createdAt: Date.now(),
    chatId,
    chatName,
    chatType,
    mode: "tail",
    tailCount,
    buffer: [],
  };

  if (ctx.manager) {
    (ctx.manager as WindowManager).insertTypedWindow(window, ctx.thread);
  } else {
    thread.contextWindows = [...(thread.contextWindows ?? []), window];
  }
  return `已创建 feishu_chat_window（id=${window.id}, chat=${chatId}）；建议立即 open method=refresh 验证拉取链路。`;
}
