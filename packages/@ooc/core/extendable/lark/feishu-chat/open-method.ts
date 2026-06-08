/**
 * root.open_feishu_chat — 创建一个 feishu_chat_window，把飞书群聊 / 单聊作为 ContextWindow。
 *
 * - args: chat_id（必填）, chat_name?（可选；缺省 = chat_id 的尾部）, chat_type?, tail_count?
 * - 给齐 chat_id 直建 window，但不立即 refresh：让 LLM 显式 refresh 以观测一次 lark-cli 调用是否健康。
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
import type { Intent } from "../../../thinkable/context/intent.js";
import type { ContextWindow } from "../../../executable/windows/_shared/types.js";
import type { MethodExecWindow } from "../../../executable/windows/method_exec/types.js";
import type { BaseContextWindow } from "@ooc/core/_shared";
import type { WindowManager } from "../../../executable/windows/_shared/manager.js";

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
建议第一步：open(parent_window_id="<新 window id>", method="refresh") 验证鉴权与拉取链路。

调用示例：
open(method="open_feishu_chat", title="工程进展群", args={ chat_id: "oc_xxxxx", chat_type: "group", tail_count: 50 })
`.trim();

function guidanceWindows(form: BaseContextWindow, entries: Record<string, string>): ContextWindow[] {
  // batch C narrowing(N3): form 契约层是 base ContextWindow；只读 base id + 具体 form 的 method，narrow 一次。
  const sourceId = (form as MethodExecWindow).method;
  const out: ContextWindow[] = [];
  for (const [path, text] of Object.entries(entries)) {
    const safe = path.replace(/[^a-zA-Z0-9_]/g, "_");
    out.push({
      id: "guidance_" + form.id + "_" + safe,
      type: "guidance",
      parentWindowId: form.id,
      boundFormId: form.id,
      title: path,
      status: "open",
      createdAt: 0,
      relevance: { score: 0.8, signalCount: 1 },
      provenance: {
        kind: "derived",
        reason: { mechanism: "form_bound", sourceId },
        createdAt: 0,
        lastTouchedAt: 0,
      },
      content: text,
      summary: text.length > 200 ? text.slice(0, 200) + "..." : text,
    } as ContextWindow);
  }
  return out;
}

export const openFeishuChatMethod: ObjectMethod = {
  paths: ["open_feishu_chat"],
  intent: (): Intent[] => [],
  onFormChange(change, { form }) {
    if (change.kind === "status_changed" && change.to !== "open") return [];
    const args = change.kind === "args_refined" ? change.args : (form as any).accumulatedArgs ?? {};
    const entries: Record<string, string> = { [OPEN_FEISHU_CHAT_BASIC]: KNOWLEDGE };
    if (change.kind === "status_changed") {
      // formStatus check was `formStatus !== "open"` → don't add input guidance
      // (entries already has BASIC; skip adding INPUT when status is not open)
    } else {
      if (typeof args.chat_id !== "string" || !args.chat_id) {
        entries[OPEN_FEISHU_CHAT_INPUT] =
          "open_feishu_chat 缺少 chat_id；用 refine(args={ chat_id: \"oc_xxx\", chat_name?: \"...\", chat_type?: \"group\", tail_count?: 30 })。";
      }
    }
    // Re-evaluate: old logic: if formStatus !== "open" return just BASIC.
    // If status IS open AND args changed (or initial args), check chat_id.
    // Simpler: just use status from form.
    const status: string = change.kind === "status_changed" ? change.to : form.status;
    if (status !== "open") {
      return guidanceWindows(form, { [OPEN_FEISHU_CHAT_BASIC]: KNOWLEDGE });
    }
    const finalEntries: Record<string, string> = { [OPEN_FEISHU_CHAT_BASIC]: KNOWLEDGE };
    if (typeof args.chat_id !== "string" || !args.chat_id) {
      finalEntries[OPEN_FEISHU_CHAT_INPUT] =
        "open_feishu_chat 缺少 chat_id；用 refine(args={ chat_id: \"oc_xxx\", chat_name?: \"...\", chat_type?: \"group\", tail_count?: 30 })。";
    }
    return guidanceWindows(form, finalEntries);
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
    // window.title 直接用 chatName；window type 徽章 (FSCHAT) 已标明是飞书群聊，
    // 不再加 "[飞书群]" 前缀冗余（避免 sidebar / 树节点截断时真名被前缀挤掉）。
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
    // batch C narrowing(N2): ctx.manager 契约层是 unknown，narrow 回 WindowManager 取 insertTypedWindow。
    (ctx.manager as WindowManager).insertTypedWindow(window, ctx.thread);
  } else {
    thread.contextWindows = [...(thread.contextWindows ?? []), window];
  }
  return `已创建 feishu_chat_window（id=${window.id}, chat=${chatId}）；建议立即 open method=refresh 验证拉取链路。`;
}
