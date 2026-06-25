/**
 * feishu_app —— ooc class。飞书集成 tool-object（单例 class）。
 *
 * 设计：
 * - send_message(chatId, content) —— 发飞书 IM 消息（stub: 仅日志）
 * - search_doc(query) —— 搜飞书云文档（stub）
 *
 * 真实接入需要 lark-openapi-sdk（OAuth + chat / doc API）；当前是协议占位、可被 LLM 看见
 * 与调用，调用结果回写到 ctx.runtime（thread.events）。
 */
import type { OocClass, OocObjectRef } from "@ooc/core/runtime/ooc-class.js";
import type {
  ObjectConstructor,
  ConstructorContext,
  ReadableModule,
  ReadableContext,
  ReadonlySelfProxy,
  ExecutableModule,
  ObjectMethod,
  ExecutableContext,
} from "@ooc/core/types/index.js";
import { xmlElement, xmlText } from "@ooc/core/types/xml.js";
import { observeLog } from "@ooc/core/observable/index.js";
import type { Data } from "./types.js";

const construct: ObjectConstructor<Data> = {
  description: "Initialize the feishu_app integration.",
  schema: {
    appId: { type: "string", required: false, description: "feishu app id" },
  },
  exec: (_ctx: ConstructorContext, args: { appId?: string }): Data => ({
    appId: args.appId,
    recentChats: [],
  }),
};

const sendMessageMethod: ObjectMethod<Data> = {
  name: "send_message",
  description: "Send a Feishu IM message to a chat.",
  schema: {
    chatId: { type: "string", required: true, description: "Feishu chat id" },
    content: { type: "string", required: true, description: "message body" },
  },
  exec: async (_ctx: ExecutableContext, self, args: { chatId?: string; content?: string }) => {
    const chatId = args.chatId ?? "";
    const content = args.content ?? "";
    if (!chatId) return { err: "[feishu.send_message] missing chatId" };
    if (!chatId || !content) return { err: "[feishu.send_message] missing args" };
    // stub: 仅日志 + 缓存 chatId
    if (!self.data.recentChats.includes(chatId)) self.data.recentChats.push(chatId);
    observeLog(
      "feishu.send_message",
      `[feishu] send to ${chatId}: ${content.slice(0, 80)}${content.length > 80 ? "..." : ""}`,
    );
    return { message: `[feishu] message queued to ${chatId} (stub)` };
  },
};

const searchDocMethod: ObjectMethod<Data> = {
  name: "search_doc",
  description: "Search Feishu cloud docs.",
  schema: {
    query: { type: "string", required: true, description: "search query" },
  },
  exec: async (_ctx: ExecutableContext, _self, args: { query?: string }) => {
    const query = args.query ?? "";
    if (!query) return { err: "[feishu.search_doc] missing query" };
    observeLog("feishu.search_doc", `[feishu] search doc: ${query}`);
    return { message: `[feishu] search '${query}' returned 0 results (stub)` };
  },
};

const executable: ExecutableModule<Data> = {
  methods: [sendMessageMethod, searchDocMethod],
};

const readable: ReadableModule<Data, unknown> = {
  readable: (_ctx: ReadableContext, self: ReadonlySelfProxy<Data>, _win: OocObjectRef<unknown>) => ({
    class: "feishu_app",
    content: [
      xmlElement(
        "feishu_app",
        { appId: self.data?.appId ?? "(not configured)" },
        [
          xmlText(
            "Feishu integration. Tools: send_message(chatId, content), search_doc(query).",
          ),
        ],
      ),
    ],
  }),
  window: [
    {
      class: "feishu_app",
      object_methods: ["send_message", "search_doc"],
      window_methods: [],
    },
  ],
};

export const Class: OocClass<Data> = {
  id: "_builtin/feishu_app",
  construct,
  executable,
  readable,
};

export type { Data } from "./types.js";
