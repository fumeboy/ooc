/**
 * feishu_doc —— 把飞书文档作为 OOC object（context window）引入。
 *
 * 一处 `export const Class: OocClass<Data>` 装配 construct（据 args 产初始 Data）+
 * executable（doc object methods）+ readable（投影成 window）。
 * 注册由 windows/index.ts 显式 `builtinRegistry.register("_builtin/feishu_app/feishu_doc", Class, { parentClass: null })`。
 *
 * feishu_doc 是窗类型（parentClass:null），通常由 feishu_app.open_doc 经
 * `ctx.runtime.instantiate("_builtin/feishu_app/feishu_doc", args)` 实例化。
 */

import type { OocClass } from "@ooc/core/runtime/ooc-class.js";
import type { ConstructorContext } from "@ooc/core/executable/contract.js";
import executable from "./executable/index.js";
import readable from "./readable/index.js";
import type { Data } from "./types.js";

const VALID_KINDS = ["doc", "docx", "sheet", "base", "wiki", "drive_md"] as const;

export const Class: OocClass<Data> = {
  construct: {
    description: "Open a Feishu doc as a context window object.",
    schema: {
      args: {
        doc_token: { type: "string", required: true, description: "飞书文档 token（doccnXXX / wikXXX）" },
        doc_kind: { type: "string", enum: [...VALID_KINDS], description: "文档类型，默认 docx" },
        doc_title: { type: "string", description: "文档标题（read 时会更新）" },
      },
    },
    exec: (_ctx: ConstructorContext, args: Record<string, unknown>): Data => {
      const docToken = typeof args.doc_token === "string" ? args.doc_token : "";
      const rawKind = typeof args.doc_kind === "string" ? args.doc_kind : "docx";
      const docKind = (VALID_KINDS as readonly string[]).includes(rawKind)
        ? (rawKind as Data["docKind"])
        : "docx";
      const docTitle =
        typeof args.doc_title === "string" && args.doc_title ? args.doc_title : docToken.slice(-8);
      return {
        docToken,
        docKind,
        docTitle,
        content: { format: "markdown", body: "" },
        mode: "read",
      };
    },
  },
  executable,
  readable,
};

export type { Data } from "./types.js";
