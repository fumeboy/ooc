/**
 * root —— executable 维度（object method）。
 *
 * root 是一切 Object 继承链的终点（BASE 锚点），自身无智能能力——agency（talk/plan/todo/end）
 * 已搬去 _builtin/agent。root 类只保留边缘 misc method：
 * - example          : 教学样板（实例化 example 对象）
 * - open_feishu_chat : 飞书群聊/单聊 window（extendable 集成）
 * - open_feishu_doc  : 飞书文档 window（extendable 集成）
 *
 * default export `{methods:[...]}`，由 index.ts 的 `export const Class` 装配。
 */

import type {
  ExecutableContext,
  ObjectMethod,
  ExecutableModule,
} from "@ooc/core/executable/contract.js";
import {
  executeOpenFeishuChat,
} from "@ooc/core/extendable/lark/feishu-chat/open-method.js";
import {
  executeOpenFeishuDoc,
} from "@ooc/core/extendable/lark/feishu-doc/open-method.js";
import { exampleMethod } from "./method.example.js";
import type { Data } from "../types.js";

// deferred: 飞书 opener 的执行体（executeOpenFeishuChat/Doc）仍是旧契约
// （单参 MethodExecutionContext{thread,args,manager}，体内 WindowManager.insertTypedWindow +
// FeishuChatWindow/FeishuDocWindow 强类型）。core 反推阶段把它们迁到新契约后，此处直接调
// 新签名；本轮经 unknown 桥接 (ctx,self,args) → 旧 ctx，保留业务逻辑体。
function bridgeLegacyExec(
  legacy: (ctx: any) => Promise<string | undefined>,
): ObjectMethod<Data>["exec"] {
  return async (ctx: ExecutableContext, _self: Data, args: Record<string, unknown>) => {
    const legacyCtx = { thread: ctx.thread, args } as unknown;
    return await legacy(legacyCtx);
  };
}

const openFeishuChatMethod: ObjectMethod<Data> = {
  name: "open_feishu_chat",
  description: "Open a Feishu (Lark) chat as a window in context.",
  schema: {
    args: {
      chat_id: { type: "string", required: true, description: "飞书 chat_id (oc_xxx)" },
      chat_name: { type: "string", description: "群名/对方姓名" },
      chat_type: { type: "string", enum: ["group", "p2p", "topic"] },
      tail_count: { type: "number", description: "首屏 buffer 条数（默认 30）" },
    },
  },
  exec: bridgeLegacyExec(executeOpenFeishuChat),
};

const openFeishuDocMethod: ObjectMethod<Data> = {
  name: "open_feishu_doc",
  description: "Open a Feishu (Lark) doc as a window in context.",
  schema: {
    args: {
      doc_token: { type: "string", required: true, description: "飞书文档 token" },
      doc_kind: {
        type: "string",
        enum: ["doc", "docx", "sheet", "base", "wiki", "drive_md"],
        description: "文档类型",
      },
      doc_title: { type: "string", description: "文档标题" },
    },
  },
  exec: bridgeLegacyExec(executeOpenFeishuDoc),
};

export const ROOT_METHODS: ObjectMethod<Data>[] = [
  exampleMethod,
  openFeishuChatMethod,
  openFeishuDocMethod,
];

const executable: ExecutableModule<Data> = {
  methods: ROOT_METHODS,
};

export default executable;
