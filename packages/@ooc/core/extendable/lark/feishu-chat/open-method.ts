/**
 * root.open_feishu_chat — 创建 feishu_chat 对象（window）。
 *
 * 新契约（Wave 4）：`exec(ctx, self, args)`；建窗经 `ctx.runtime.instantiate("feishu_chat", args)`
 * （不再 `ctx.manager.insertTypedWindow` + 强类型整窗）。feishu_chat 的初始 Data 由其 class 的
 * construct 据 args 产出。
 */

import type { ExecutableContext } from "../../../executable/contract.js";

const FEISHU_CHAT_CLASS = "feishu_chat";

export async function executeOpenFeishuChat(
  ctx: ExecutableContext,
  _self: unknown,
  args: Record<string, unknown>,
): Promise<string | undefined> {
  if (!ctx.runtime) return "[open_feishu_chat] 缺少 runtime 句柄，无法实例化 feishu_chat。";
  const chatId = typeof args.chat_id === "string" ? args.chat_id : "";
  if (!chatId) return "[open_feishu_chat] 缺少 chat_id。";
  const chatName =
    typeof args.chat_name === "string" && args.chat_name ? args.chat_name : chatId.slice(-8);
  const chatType =
    args.chat_type === "group" || args.chat_type === "p2p" || args.chat_type === "topic"
      ? (args.chat_type as "group" | "p2p" | "topic")
      : undefined;
  const rawCount = Number(args.tail_count);
  const tailCount =
    Number.isFinite(rawCount) && rawCount > 0
      ? Math.min(Math.max(Math.floor(rawCount), 1), 100)
      : 30;

  const id = await ctx.runtime.instantiate(FEISHU_CHAT_CLASS, {
    title: chatName,
    chat_id: chatId,
    chat_name: chatName,
    chat_type: chatType,
    tail_count: tailCount,
  });
  return `已创建 feishu_chat（id=${id}, chat=${chatId}）；建议立即 exec(method="refresh") 验证拉取链路。`;
}
