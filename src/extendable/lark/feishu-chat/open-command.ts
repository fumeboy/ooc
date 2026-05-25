/**
 * root.open_feishu_chat — 创建一个 feishu_chat_window，把飞书群聊 / 单聊作为 ContextWindow。
 *
 * - args: chat_id（必填）, chat_name?（可选；缺省 = chat_id 的尾部）, chat_type?, tail_count?
 * - 给齐 chat_id 直建 window，但不立即 refresh：让 LLM 显式 refresh 以观测一次 lark-cli 调用是否健康。
 */

import type {
  CommandExecutionContext,
  CommandKnowledgeEntries,
  CommandTableEntry,
} from "../../../executable/windows/_shared/command-types.js";
import {
  ROOT_WINDOW_ID,
  generateWindowId,
  type FeishuChatWindow,
} from "../../../executable/windows/_shared/types.js";

const OPEN_FEISHU_CHAT_BASIC = "internal/executable/open_feishu_chat/basic";
const OPEN_FEISHU_CHAT_INPUT = "internal/executable/open_feishu_chat/input";

const KNOWLEDGE = `
open_feishu_chat 用于创建一个 feishu_chat_window（飞书群聊 / 单聊作为 ContextWindow）。

参数：
- chat_id: 必填，飞书 chat_id（oc_xxx）
- chat_name: 可选，群名 / 对方姓名；缺省由 chat_id 派生（refresh 后覆盖为飞书一侧的真实名）
- chat_type: 可选，"group" | "p2p" | "topic"
- tail_count: 可选，期望首屏 buffer 条数，1..100，缺省 30

副作用：仅本地创建 window；不立即拉取消息。
建议第一步：open(parent_window_id="<新 window id>", command="refresh") 验证鉴权与拉取链路。

调用示例：
open(command="open_feishu_chat", title="工程进展群", args={ chat_id: "oc_xxxxx", chat_type: "group", tail_count: 50 })
`.trim();

export const openFeishuChatCommand: CommandTableEntry = {
  paths: ["open_feishu_chat"],
  match: () => ["open_feishu_chat"],
  knowledge: (args, formStatus): CommandKnowledgeEntries => {
    const entries: CommandKnowledgeEntries = { [OPEN_FEISHU_CHAT_BASIC]: KNOWLEDGE };
    if (formStatus !== "open") return entries;
    if (typeof args.chat_id !== "string" || !args.chat_id) {
      entries[OPEN_FEISHU_CHAT_INPUT] =
        "open_feishu_chat 缺少 chat_id；用 refine(args={ chat_id: \"oc_xxx\", chat_name?: \"...\", chat_type?: \"group\", tail_count?: 30 })。";
    }
    return entries;
  },
  exec: (ctx) => executeOpenFeishuChat(ctx),
};

export async function executeOpenFeishuChat(
  ctx: CommandExecutionContext,
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
    title: `[飞书群] ${chatName}`,
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
    ctx.manager.insertTypedWindow(window);
  } else {
    thread.contextWindows = [...(thread.contextWindows ?? []), window];
  }
  return `已创建 feishu_chat_window（id=${window.id}, chat=${chatId}）；建议立即 open command=refresh 验证拉取链路。`;
}
