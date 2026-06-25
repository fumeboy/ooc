/**
 * feishu_app —— ooc class。飞书集成 tool-object（单例 class）。
 *
 * 真实接入 lark-openapi-sdk：env-gated（FEISHU_APP_ID / FEISHU_APP_SECRET 缺失则 fallback 到 stub），
 * 失败不阻塞 thinkloop（observeWarn + 返回 err message）。
 *
 * 接入面（最小）：
 * - `send_message(chat_id, content)` —— Feishu IM 文本消息
 * - `search_doc(query)` —— Feishu 云文档搜索
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
import { observeLog, observeWarn } from "@ooc/core/observable/index.js";
import type { Data } from "./types.js";
import { getLarkClient, isLarkConfigured } from "./lark-client.js";

const construct: ObjectConstructor<Data> = {
  description: "Initialize the feishu_app integration.",
  schema: {
    appId: { type: "string", required: false, description: "feishu app id (or use FEISHU_APP_ID env)" },
  },
  exec: (_ctx: ConstructorContext, args: { appId?: string }): Data => ({
    appId: args.appId ?? process.env.FEISHU_APP_ID,
    recentChats: [],
  }),
};

const sendMessageMethod: ObjectMethod<Data> = {
  name: "send_message",
  description: "Send a Feishu IM message to a chat (uses lark sdk if FEISHU_APP_ID/SECRET set; else logs only).",
  schema: {
    chat_id: { type: "string", required: true, description: "Feishu chat id" },
    content: { type: "string", required: true, description: "message body" },
  },
  exec: async (_ctx: ExecutableContext, self, args: { chat_id?: string; content?: string }) => {
    const chatId = args.chat_id ?? "";
    const content = args.content ?? "";
    if (!chatId || !content) return { err: "[feishu.send_message] missing chat_id or content" };
    if (!self.data.recentChats.includes(chatId)) self.data.recentChats.push(chatId);
    if (!isLarkConfigured()) {
      observeLog(
        "feishu.send_message.stub",
        `[feishu/stub] would send to ${chatId}: ${content.slice(0, 80)}`,
      );
      return { message: `[feishu] message queued to ${chatId} (stub: FEISHU_APP_ID not set)` };
    }
    try {
      const client = getLarkClient();
      const res = await client.im.message.create({
        params: { receive_id_type: "chat_id" },
        data: {
          receive_id: chatId,
          msg_type: "text",
          content: JSON.stringify({ text: content }),
        },
      });
      return { message: `[feishu] sent to ${chatId} (message_id=${res.data?.message_id ?? "?"})` };
    } catch (err) {
      observeWarn("feishu.send_message.fail", `[feishu] send failed: ${(err as Error).message}`);
      return { err: `[feishu.send_message] ${(err as Error).message}` };
    }
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
    if (!isLarkConfigured()) {
      observeLog("feishu.search_doc.stub", `[feishu/stub] search: ${query}`);
      return { message: `[feishu] search '${query}' (stub: FEISHU_APP_ID not set)` };
    }
    try {
      const client = getLarkClient();
      // 飞书 search API：drive.file.search v1（应用层 OAuth 需要）
      const res = await (client.drive.file as unknown as {
        search?: (opts: unknown) => Promise<unknown>;
      }).search?.({ data: { search_key: query, count: 10 } });
      const hits = (res as { data?: { files?: unknown[] } } | undefined)?.data?.files ?? [];
      return { message: `[feishu] search '${query}' → ${hits.length} hits` };
    } catch (err) {
      observeWarn("feishu.search_doc.fail", `[feishu] search failed: ${(err as Error).message}`);
      return { err: `[feishu.search_doc] ${(err as Error).message}` };
    }
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
        { appId: self.data?.appId ?? "(not configured)", configured: String(isLarkConfigured()) },
        [
          xmlText(
            "Feishu integration. Tools: send_message(chat_id, content), search_doc(query).",
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
