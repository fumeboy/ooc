/**
 * feishu_chat —— 把飞书群聊 / 单聊作为 OOC object（context window）引入。
 *
 * 一处 `export const Class: OocClass<Data>` 装配 construct（据 args 产初始 Data）+
 * executable（chat object methods）+ readable（投影成 window）。
 * 注册由 windows/index.ts 显式 `builtinRegistry.register("_builtin/feishu_chat", Class, { parentClass: null })`。
 *
 * feishu_chat 是窗类型（parentClass:null），通常由 feishu_app.open_chat 经
 * `ctx.runtime.instantiate("_builtin/feishu_chat", args)` 实例化。
 */

import type { OocClass } from "@ooc/core/runtime/ooc-class.js";
import type { ConstructorContext } from "@ooc/core/executable/contract.js";
import executable, { clampCount } from "./executable/index.js";
import readable from "./readable/index.js";
import type { Data } from "./types.js";

const DEFAULT_TAIL = 30;

export const Class: OocClass<Data> = {
  construct: {
    description: "Open a Feishu chat (group / p2p) as a context window object.",
    schema: {
      args: {
        chat_id: { type: "string", required: true, description: "飞书 chat_id（oc_xxx）" },
        chat_name: { type: "string", description: "群名 / 单聊对端名" },
        chat_type: { type: "string", enum: ["group", "p2p", "topic"] },
        tail_count: { type: "number", description: "初始 tail 条数，默认 30" },
      },
    },
    exec: (_ctx: ConstructorContext, args: Record<string, unknown>): Data => {
      const chatId = typeof args.chat_id === "string" ? args.chat_id : "";
      const chatName =
        typeof args.chat_name === "string" && args.chat_name ? args.chat_name : chatId.slice(-8);
      const chatType =
        args.chat_type === "group" || args.chat_type === "p2p" || args.chat_type === "topic"
          ? (args.chat_type as "group" | "p2p" | "topic")
          : undefined;
      return {
        chatId,
        chatName,
        chatType,
        mode: "tail",
        tailCount: clampCount(args.tail_count, DEFAULT_TAIL),
        buffer: [],
      };
    },
  },
  executable,
  readable,
};

export type { Data } from "./types.js";
