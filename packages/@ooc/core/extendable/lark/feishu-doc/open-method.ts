/**
 * root.open_feishu_doc — 创建 feishu_doc 对象（window）。
 *
 * 新契约（Wave 4）：`exec(ctx, self, args)`；建窗经 `ctx.runtime.instantiate("feishu_doc", args)`
 * （不再 `ctx.manager.insertTypedWindow` + 强类型整窗）。feishu_doc 的初始 Data 由其 class 的
 * construct 据 args 产出。
 */

import type { ExecutableContext } from "../../../executable/contract.js";

const FEISHU_DOC_CLASS = "feishu_doc";
const VALID_KINDS = ["doc", "docx", "sheet", "base", "wiki", "drive_md"] as const;
type DocKind = (typeof VALID_KINDS)[number];

export async function executeOpenFeishuDoc(
  ctx: ExecutableContext,
  _self: unknown,
  args: Record<string, unknown>,
): Promise<string | undefined> {
  if (!ctx.runtime) return "[open_feishu_doc] 缺少 runtime 句柄，无法实例化 feishu_doc。";
  const docToken = typeof args.doc_token === "string" ? args.doc_token : "";
  if (!docToken) return "[open_feishu_doc] 缺少 doc_token。";
  const rawKind = typeof args.doc_kind === "string" ? args.doc_kind : "docx";
  const docKind = (VALID_KINDS as readonly string[]).includes(rawKind)
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
  return `已创建 feishu_doc（id=${id}, doc_token=${docToken}, kind=${docKind}）；建议立即 exec(method="read") 验证拉取链路。`;
}
