/**
 * root.open_feishu_doc — 创建一个 feishu_doc_window，把飞书文档作为 ContextWindow。
 *
 * - args: doc_token（必填）, doc_kind?（"doc"|"docx"|"sheet"|"base"|"wiki"|"drive_md"，缺省 "docx"）, doc_title?
 * - 给齐 doc_token 直建 window；不立即 read，让 LLM 显式 read 以验证鉴权 / scope。
 */

import type {
  MethodExecutionContext,
  ObjectMethod,
} from "../../../executable/windows/_shared/command-types.js";
import {
  ROOT_WINDOW_ID,
  generateWindowId,
  type FeishuDocWindow,
} from "../../../executable/windows/_shared/types.js";
import type { Intent } from "../../../thinkable/context/intent.js";
import type { ContextWindow } from "../../../executable/windows/_shared/types.js";
import type { MethodExecWindow } from "../../../executable/windows/method_exec/types.js";
import type { BaseContextWindow } from "@ooc/core/_shared";
import type { WindowManager } from "../../../executable/windows/_shared/manager.js";

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
建议第一步：open(parent_window_id="<新 window id>", method="read", args={ format: "markdown" })。

调用示例：
open(method="open_feishu_doc", title="OOC 设计稿", args={ doc_token: "doccn5xxxxxx", doc_kind: "docx" })
`.trim();

function guidanceWindows(form: BaseContextWindow, entries: Record<string, string>): ContextWindow[] {
  // batch C narrowing(N3): form 契约层是 base ContextWindow；只读 base id + 具体 form 的 command，narrow 一次。
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

export const openFeishuDocMethod: ObjectMethod = {
  paths: ["open_feishu_doc"],
  intent: (): Intent[] => [],
  onFormChange(change, { form, intents }) {
    if (change.kind === "status_changed" && change.to !== "open") return [];
    // batch C narrowing(N1): onFormChange 的 form 契约层是 base，narrow 回 MethodExecWindow 取 accumulatedArgs。
    const args = change.kind === "args_refined" ? change.args : (form as MethodExecWindow).accumulatedArgs;
    const formStatus = form.status;
    const entries: Record<string, string> = { [OPEN_FEISHU_DOC_BASIC]: KNOWLEDGE };
    if (formStatus !== "open") return guidanceWindows(form, entries);
    if (typeof args.doc_token !== "string" || !args.doc_token) {
      entries[OPEN_FEISHU_DOC_INPUT] =
        "open_feishu_doc 缺少 doc_token；用 refine(args={ doc_token: \"doccnXXX\", doc_kind?: \"docx\", doc_title?: \"...\" })。";
    }
    return guidanceWindows(form, entries);
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
    // batch C narrowing(N2): ctx.manager 契约层是 unknown，narrow 回 WindowManager 取 insertTypedWindow。
    (ctx.manager as WindowManager).insertTypedWindow(window, ctx.thread);
  } else {
    thread.contextWindows = [...(thread.contextWindows ?? []), window];
  }
  return `已创建 feishu_doc_window（id=${window.id}, doc_token=${docToken}, kind=${docKind}）；建议立即 open command=read 验证拉取链路。`;
}
