/**
 * root.open_feishu_doc — 创建一个 feishu_doc_window，把飞书文档作为 ContextWindow。
 *
 * - args: doc_token（必填）, doc_kind?（"doc"|"docx"|"sheet"|"base"|"wiki"|"drive_md"，缺省 "docx"）, doc_title?
 * - 给齐 doc_token 直建 window；不立即 read，让 LLM 显式 read 以验证鉴权 / scope。
 */

import type {
  MethodExecutionContext,
  MethodKnowledgeEntries,
  MethodEntry,
} from "../../../executable/windows/_shared/method-types.js";
import {
  ROOT_WINDOW_ID,
  generateWindowId,
  type FeishuDocWindow,
} from "../../../executable/windows/_shared/types.js";

const OPEN_FEISHU_DOC_BASIC = "internal/executable/open_feishu_doc/basic";
const OPEN_FEISHU_DOC_INPUT = "internal/executable/open_feishu_doc/input";

const VALID_KINDS = ["doc", "docx", "sheet", "base", "wiki", "drive_md"] as const;
type DocKind = (typeof VALID_KINDS)[number];

const KNOWLEDGE = `
open_feishu_doc 用于创建一个 feishu_doc_window（飞书文档作为 ContextWindow）。

参数：
- doc_token: 必填，飞书文档 token（doccnXXXXX / docxXXXXX / wikXXXXX 等）
- doc_kind: 可选，"doc" | "docx" | "sheet" | "base" | "wiki" | "drive_md"；缺省 "docx"
- doc_title: 可选，文档标题；缺省由 doc_token 派生（read 后覆盖为飞书一侧的真实标题）

副作用：仅本地创建 window；不立即拉取内容。
建议第一步：open(parent_window_id="<新 window id>", command="read", args={ format: "markdown" })。

调用示例：
open(command="open_feishu_doc", title="OOC 设计稿", args={ doc_token: "doccn5xxxxxx", doc_kind: "docx" })
`.trim();

export const openFeishuDocCommand: MethodEntry = {
  paths: ["open_feishu_doc"],
  match: () => ["open_feishu_doc"],
  knowledge: (args, formStatus): MethodKnowledgeEntries => {
    const entries: MethodKnowledgeEntries = { [OPEN_FEISHU_DOC_BASIC]: KNOWLEDGE };
    if (formStatus !== "open") return entries;
    if (typeof args.doc_token !== "string" || !args.doc_token) {
      entries[OPEN_FEISHU_DOC_INPUT] =
        "open_feishu_doc 缺少 doc_token；用 refine(args={ doc_token: \"doccnXXX\", doc_kind?: \"docx\", doc_title?: \"...\" })。";
    }
    return entries;
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
    type: "feishu_doc",
    parentWindowId: ROOT_WINDOW_ID,
    // window.title 直接用 docTitle；window type 徽章 (FSDOC) 已标明是飞书文档，
    // 不再加 "[飞书文档]" 前缀冗余。
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
    ctx.manager.insertTypedWindow(window);
  } else {
    thread.contextWindows = [...(thread.contextWindows ?? []), window];
  }
  return `已创建 feishu_doc_window（id=${window.id}, doc_token=${docToken}, kind=${docKind}）；建议立即 open command=read 验证拉取链路。`;
}
