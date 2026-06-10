/**
 * root.open_feishu_doc — 创建 feishu_doc_window。
 */

import type {
  MethodExecutionContext,
  ObjectMethod,
} from "../../../executable/windows/_shared/method-types.js";
import {
  ROOT_WINDOW_ID,
  generateWindowId,
  type FeishuDocWindow,
} from "../../../executable/windows/_shared/types.js";
import type { WindowManager } from "../../../executable/windows/_shared/manager.js";

const OPEN_TIP = `open_feishu_doc 创建飞书文档 window。
参数：doc_token（必填）、doc_kind（可选 doc/docx/sheet/base/wiki/drive_md，默认 docx）、doc_title（可选）。
创建后建议立即 read 验证拉取。`;

const VALID_KINDS = ["doc", "docx", "sheet", "base", "wiki", "drive_md"] as const;
type DocKind = (typeof VALID_KINDS)[number];

export const openFeishuDocMethod: ObjectMethod = {
  description: "Open a Feishu (Lark) doc as a window in context.",
  intents: ["open_feishu_doc"],
  schema: {
    args: {
      doc_token: { type: "string", required: true, description: "飞书文档 token" },
      doc_kind: { type: "string", enum: ["doc", "docx", "sheet", "base", "wiki", "drive_md"], description: "文档类型" },
      doc_title: { type: "string", description: "文档标题" },
    },
  },
  onFormChange(change, { args }) {
    const hasToken = typeof args.doc_token === "string" && args.doc_token.length > 0;
    return {
      tip: hasToken ? `Opening doc ${args.doc_token}...` : OPEN_TIP,
      intents: [{ name: "open_feishu_doc" }],
      quick_exec_submit: hasToken,
    };
  },
  exec: (ctx) => executeOpenFeishuDoc(ctx),
};

export async function executeOpenFeishuDoc(
  ctx: MethodExecutionContext,
): Promise<string | undefined> {
  const thread = ctx.thread;
  if (!thread) return "[open_feishu_doc] 缺少 thread context。";
  const docToken = typeof ctx.args.doc_token === "string" ? ctx.args.doc_token : "";
  if (!docToken) return "[open_feishu_doc] 缺少 doc_token。";
  const rawKind = typeof ctx.args.doc_kind === "string" ? ctx.args.doc_kind : "docx";
  const docKind = (VALID_KINDS as readonly string[]).includes(rawKind) ? (rawKind as DocKind) : "docx";
  const docTitle =
    typeof ctx.args.doc_title === "string" && ctx.args.doc_title
      ? ctx.args.doc_title
      : docToken.slice(-8);

  const window: FeishuDocWindow = {
    id: generateWindowId("feishu_doc"),
    class: "feishu_doc",
    parentWindowId: ROOT_WINDOW_ID,
    title: docTitle,
    status: "open",
    createdAt: Date.now(),
    docToken,
    docKind,
    docTitle,
    content: { format: "markdown", body: "" },
    mode: "read",
  };

  if (ctx.manager) {
    (ctx.manager as WindowManager).insertTypedWindow(window, ctx.thread);
  } else {
    thread.contextWindows = [...(thread.contextWindows ?? []), window];
  }
  return `已创建 feishu_doc_window（id=${window.id}, doc_token=${docToken}, kind=${docKind}）；建议立即 exec(method="read") 验证拉取链路。`;
}
