/**
 * feishu_app —— executable 维度（object method）。
 *
 * feishu_app 是飞书接入点单例 object 的 own method 库（继承 agent 的 agency 经 class 链）：
 * - open_chat：把一个飞书群聊 / 单聊作为 feishu_chat 子对象引入 context
 * - open_doc ：把一个飞书文档作为 feishu_doc 子对象引入 context
 *
 * 建子对象经 `ctx.runtime.instantiate("_builtin/feishu_app/feishu_chat"|"_builtin/feishu_app/feishu_doc", args)`；
 * 子对象初始 Data 由其 class 的 construct 据 args 产出。method 把新建 id 记入 self（运行态）
 * 供 readable 投影列出。
 */

import type {
  ObjectMethod,
  ExecutableModule,
} from "@ooc/core/executable/contract.js";
import type { SelfProxy } from "@ooc/core/_shared/types/self-proxy.js";
import type { Data } from "../types.js";

const FEISHU_CHAT_CLASS = "_builtin/feishu_app/feishu_chat";
const FEISHU_DOC_CLASS = "_builtin/feishu_app/feishu_doc";
const VALID_DOC_KINDS = ["doc", "docx", "sheet", "base", "wiki", "drive_md"] as const;
type DocKind = (typeof VALID_DOC_KINDS)[number];

const openChatMethod: ObjectMethod<Data> = {
  name: "open_chat",
  description: "Open a Feishu (Lark) chat (group / p2p) as a feishu_chat object in context.",
  schema: {
    args: {
      chat_id: { type: "string", required: true, description: "飞书 chat_id（oc_xxx）" },
      chat_name: { type: "string", description: "群名 / 单聊对端名" },
      chat_type: { type: "string", enum: ["group", "p2p", "topic"] },
      tail_count: { type: "number", description: "初始 tail 条数，默认 30" },
    },
  },
  exec: async (ctx, self, args) => {
    if (!ctx.runtime) return "[feishu_app.open_chat] 缺少 runtime 句柄，无法实例化 feishu_chat。";
    const chatId = typeof args.chat_id === "string" ? args.chat_id : "";
    if (!chatId) return "[feishu_app.open_chat] 缺少 chat_id。";
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
    self.data.openedChatObjectIds = [...(self.data.openedChatObjectIds ?? []), id];
    return `已创建 feishu_chat（id=${id}, chat=${chatId}）；建议立即 exec(method="refresh") 验证拉取链路。`;
  },
};

const openDocMethod: ObjectMethod<Data> = {
  name: "open_doc",
  description: "Open a Feishu (Lark) doc as a feishu_doc object in context.",
  schema: {
    args: {
      doc_token: { type: "string", required: true, description: "飞书文档 token（doccnXXX / wikXXX）" },
      doc_kind: { type: "string", enum: [...VALID_DOC_KINDS], description: "文档类型，默认 docx" },
      doc_title: { type: "string", description: "文档标题（read 时会更新）" },
    },
  },
  exec: async (ctx, self, args) => {
    if (!ctx.runtime) return "[feishu_app.open_doc] 缺少 runtime 句柄，无法实例化 feishu_doc。";
    const docToken = typeof args.doc_token === "string" ? args.doc_token : "";
    if (!docToken) return "[feishu_app.open_doc] 缺少 doc_token。";
    const rawKind = typeof args.doc_kind === "string" ? args.doc_kind : "docx";
    const docKind = (VALID_DOC_KINDS as readonly string[]).includes(rawKind)
      ? (rawKind as DocKind)
      : "docx";
    const docTitle =
      typeof args.doc_title === "string" && args.doc_title ? args.doc_title : docToken.slice(-8);

    const id = await ctx.runtime.instantiate(FEISHU_DOC_CLASS, {
      title: docTitle,
      doc_token: docToken,
      doc_kind: docKind,
      doc_title: docTitle,
    });
    self.data.openedDocObjectIds = [...(self.data.openedDocObjectIds ?? []), id];
    return `已创建 feishu_doc（id=${id}, doc_token=${docToken}, kind=${docKind}）；建议立即 exec(method="read") 验证拉取链路。`;
  },
};

const executable: ExecutableModule<Data> = {
  methods: [openChatMethod, openDocMethod],
};

export default executable;
