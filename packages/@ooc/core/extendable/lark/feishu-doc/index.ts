/**
 * feishu_doc window — 把飞书文档作为 ContextWindow 引入 OOC。
 *
 * 注册命令：
 * - read：拉文档全文 / 段落到 window.content（无副作用）
 * - search_in_doc：文档内查找（无副作用，不改 content；返回命中位置摘要）
 * - append：在文档末尾追加内容（**强制 dry-run gate**）
 * - patch_block：修改 / 插入特定 block（**强制 dry-run gate**，且强制 versionId 检查）
 * - share_link：返回当前 doc 的可分享 URL（无副作用）
 * - attach_to_chat：把 doc 链接发到指定 chat_id（**强制 dry-run gate**）
 * - close：释放 window
 *
 * 鉴权：默认 user（飞书文档的读写都需要用户授权）；attach_to_chat 默认 bot。
 */

import type {
  MethodExecutionContext,
  ObjectMethod,
} from "../../../executable/windows/_shared/method-types.js";
import { builtinRegistry, type RenderContext } from "../../../executable/windows/_shared/registry.js";
import type { FeishuDocWindow } from "./types.js";
import { xmlElement, xmlText, truncateBytes, type XmlNode } from "../../../thinkable/context/xml.js";
import { larkExec } from "../cli.js";
import { readWorldConfig, DEFAULT_LARK_TENANT_HOST } from "../../../persistable/index.js";
import type { Intent } from "../../../thinkable/context/intent.js";
import type { ContextWindow } from "../../../executable/windows/_shared/types.js";
import type { MethodExecWindow } from "../../../executable/windows/method_exec/types.js";
import type { BaseContextWindow } from "@ooc/core/_shared";

const READ_BASIC = "internal/windows/feishu_doc/read/basic";
const SEARCH_BASIC = "internal/windows/feishu_doc/search_in_doc/basic";
const APPEND_BASIC = "internal/windows/feishu_doc/append/basic";
const APPEND_DRY_RUN = "internal/windows/feishu_doc/append/dry_run_required";
const PATCH_BASIC = "internal/windows/feishu_doc/patch_block/basic";
const PATCH_DRY_RUN = "internal/windows/feishu_doc/patch_block/dry_run_required";
const SHARE_BASIC = "internal/windows/feishu_doc/share_link/basic";
const ATTACH_BASIC = "internal/windows/feishu_doc/attach_to_chat/basic";
const ATTACH_DRY_RUN = "internal/windows/feishu_doc/attach_to_chat/dry_run_required";
const CLOSE_BASIC = "internal/windows/feishu_doc/close/basic";

const MAX_RENDER_BYTES = 12288;

const PROTOCOL_KNOWLEDGE = `
feishu_doc_window 是 OOC 与飞书文档之间的 ContextWindow。

每个 docToken 对应一个 window 实例。docKind 区分 doc / docx / sheet / base / wiki / drive_md，
不同类型在 read / patch 行为上有差异（详见各 method 知识）。

可用 method：
- read：拉全文到 window.content（mode=read）
- search_in_doc：文档内查找（无副作用）
- append：末尾追加（**有副作用，强制 dry-run gate**）
- patch_block：修改 / 插入特定 block（**有副作用，强制 dry-run gate + version 检查**）
- share_link：拿可分享 URL（无副作用）
- attach_to_chat：把文档链接发到群（**有副作用，dry-run gate**）
- close：释放 window

身份约定：默认 \`--as user\`（飞书文档读写通常依赖个人 scope）；attach_to_chat 默认 bot。

注意：飞书文档的 patch 撤销成本高，所有写类命令必须经过 dry-run 预览 + 二次 confirm。
`.trim();

const READ_KNOWLEDGE = `
feishu_doc.read 把飞书文档内容拉到 window.content（覆盖式）。

参数：
- format: 可选，"markdown" | "blocks"，缺省 "markdown"
  - markdown：把文档转 markdown 文本（lark-cli markdown +fetch；适合 docx / drive_md / wiki 中的 docx 子节点）
  - blocks：拉块结构（lark-cli docs +read --include-blocks）；适合 patch_block 前确认 block_id

调用：open(parent_window_id="<feishu_doc_window_id>", method="read", args={ format: "markdown" })

副作用：仅本地 window 字段更新；不修改飞书一侧。
`.trim();

const SEARCH_IN_DOC_KNOWLEDGE = `
feishu_doc.search_in_doc 在已 read 的 window.content 内查找关键字（纯本地，不调远端）。

参数：
- query: 必填
- limit: 可选，最多返回行数，缺省 10

返回：命中行列表（line + 周边 80 字符）。
`.trim();

const APPEND_KNOWLEDGE = `
feishu_doc.append 在文档末尾追加内容。**强制 dry-run gate**。

参数：
- text: 必填，待追加的 markdown 文本
- confirm: 必须 true 才真追加；首次 submit 触发 dry-run
`.trim();

const APPEND_DRY_RUN_KNOWLEDGE = `
当前 append form 还未走过 dry-run 预览或 args.confirm !== true。
若已确认，refine(form_id, args={ confirm: true }) 后再 submit。
`.trim();

const PATCH_KNOWLEDGE = `
feishu_doc.patch_block 修改 / 插入特定 block。**最高风险命令**——强制 dry-run gate + version 检查。

参数：
- block_id: 必填，目标块 id（先 read --format=blocks 拿到）
- op: "replace_text" | "insert_after" | "delete"
- text: replace_text / insert_after 时必填
- confirm: 必须 true；首次 submit 触发 dry-run
- expected_version: 强烈建议传入 dry-run 时记录的 versionId；不一致时 submit 失败（防止文档被他人改动后误覆盖）

调用流程：
1. read(format=blocks) 看清楚要改的 block_id 与当前 versionId
2. open patch_block + dry-run 看 lark-cli 预览
3. refine confirm=true + expected_version=<刚才记录的> → submit
`.trim();

const PATCH_DRY_RUN_KNOWLEDGE = `
patch_block 必须先 dry-run。当前 args.confirm !== true 或缺少 expected_version。
`.trim();

const SHARE_KNOWLEDGE = `
feishu_doc.share_link 返回当前文档的可分享 URL。

参数：无（基于 window.docToken / docKind 派生）。
`.trim();

const ATTACH_KNOWLEDGE = `
feishu_doc.attach_to_chat 把当前文档链接发到指定群。**强制 dry-run gate**。

参数：
- chat_id: 必填
- comment: 可选，附加文本
- confirm: 必须 true 才真发；首次 submit 触发 dry-run
- as: 可选，"bot" | "user"，缺省 bot
`.trim();

const ATTACH_DRY_RUN_KNOWLEDGE = `
attach_to_chat 当前 args.confirm !== true，仅走 dry-run 预览。
`.trim();

const CLOSE_KNOWLEDGE = `
feishu_doc.close 释放 window；不影响飞书一侧的文档。
`.trim();

// ─────────────────────────── method 实现 ────────────────────────────

function guidanceWindows(form: BaseContextWindow, entries: Record<string, string>): ContextWindow[] {
  // batch C narrowing(N3): onFormChange 的 form 契约层是 base ContextWindow；本 helper 只读
  // base `id` + 具体 form 的 method（作 provenance 标签），在此唯一处 narrow 回 MethodExecWindow。
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

const readMethod: ObjectMethod = {
  paths: ["read"],
  intent: (): Intent[] => [],
  onFormChange(change, { form, intents }) {
    if (change.kind === "status_changed" && change.to !== "open") return [];
    const entries: Record<string, string> = { [READ_BASIC]: READ_KNOWLEDGE };
    return guidanceWindows(form, entries);
  },
  exec: (ctx) => executeRead(ctx),
};

const searchInDocMethod: ObjectMethod = {
  paths: ["search_in_doc"],
  intent: (): Intent[] => [],
  onFormChange(change, { form, intents }) {
    if (change.kind === "status_changed" && change.to !== "open") return [];
    const entries: Record<string, string> = { [SEARCH_BASIC]: SEARCH_IN_DOC_KNOWLEDGE };
    return guidanceWindows(form, entries);
  },
  exec: (ctx) => executeSearchInDoc(ctx),
};

const appendMethod: ObjectMethod = {
  paths: ["append"],
  intent: (args) => (args.confirm === true ? [{ name: "append.confirmed" }] : []),
  onFormChange(change, { form, intents }) {
    if (change.kind === "status_changed" && change.to !== "open") return [];
    // batch C narrowing(N1): onFormChange 的 form 契约层是 base，narrow 回 MethodExecWindow 取 accumulatedArgs。
    const args = change.kind === "args_refined" ? change.args : (form as MethodExecWindow).accumulatedArgs;
    const formStatus = form.status;
    const entries: Record<string, string> = { [APPEND_BASIC]: APPEND_KNOWLEDGE };
    if (formStatus === "open" && args.confirm !== true) {
      entries[APPEND_DRY_RUN] = APPEND_DRY_RUN_KNOWLEDGE;
    }
    return guidanceWindows(form, entries);
  },
  exec: (ctx) => executeAppend(ctx),
};

const patchBlockMethod: ObjectMethod = {
  paths: ["patch_block"],
  intent: (args) => (args.confirm === true ? [{ name: "patch_block.confirmed" }] : []),
  onFormChange(change, { form, intents }) {
    if (change.kind === "status_changed" && change.to !== "open") return [];
    // batch C narrowing(N1): onFormChange 的 form 契约层是 base，narrow 回 MethodExecWindow 取 accumulatedArgs。
    const args = change.kind === "args_refined" ? change.args : (form as MethodExecWindow).accumulatedArgs;
    const formStatus = form.status;
    const entries: Record<string, string> = { [PATCH_BASIC]: PATCH_KNOWLEDGE };
    if (formStatus === "open" && args.confirm !== true) {
      entries[PATCH_DRY_RUN] = PATCH_DRY_RUN_KNOWLEDGE;
    }
    return guidanceWindows(form, entries);
  },
  exec: (ctx) => executePatchBlock(ctx),
};

const shareLinkMethod: ObjectMethod = {
  paths: ["share_link"],
  intent: (): Intent[] => [],
  onFormChange(change, { form, intents }) {
    if (change.kind === "status_changed" && change.to !== "open") return [];
    const entries: Record<string, string> = { [SHARE_BASIC]: SHARE_KNOWLEDGE };
    return guidanceWindows(form, entries);
  },
  exec: (ctx) => executeShareLink(ctx),
};

const attachToChatMethod: ObjectMethod = {
  paths: ["attach_to_chat"],
  intent: (args) => (args.confirm === true ? [{ name: "attach_to_chat.confirmed" }] : []),
  onFormChange(change, { form, intents }) {
    if (change.kind === "status_changed" && change.to !== "open") return [];
    // batch C narrowing(N1): onFormChange 的 form 契约层是 base，narrow 回 MethodExecWindow 取 accumulatedArgs。
    const args = change.kind === "args_refined" ? change.args : (form as MethodExecWindow).accumulatedArgs;
    const formStatus = form.status;
    const entries: Record<string, string> = { [ATTACH_BASIC]: ATTACH_KNOWLEDGE };
    if (formStatus === "open" && args.confirm !== true) {
      entries[ATTACH_DRY_RUN] = ATTACH_DRY_RUN_KNOWLEDGE;
    }
    return guidanceWindows(form, entries);
  },
  exec: (ctx) => executeAttachToChat(ctx),
};

const closeMethod: ObjectMethod = {
  paths: ["close"],
  intent: (): Intent[] => [],
  onFormChange(change, { form, intents }) {
    if (change.kind === "status_changed" && change.to !== "open") return [];
    const entries: Record<string, string> = { [CLOSE_BASIC]: CLOSE_KNOWLEDGE };
    return guidanceWindows(form, entries);
  },
  exec: () => undefined,
};

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function pickStr(obj: unknown, ...keys: string[]): string | undefined {
  if (!obj || typeof obj !== "object") return undefined;
  const r = obj as Record<string, unknown>;
  for (const k of keys) {
    const v = r[k];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return undefined;
}

/**
 * 从飞书 markdown 输出抽取文档标题（嵌在首部 \`<title>...</title>\` 标签）。
 * 没找到返回 undefined（保留调用方的 fallback 行为）。
 */
function extractMarkdownTitle(body: string): string | undefined {
  if (!body) return undefined;
  const m = body.match(/<title>([\s\S]*?)<\/title>/i);
  if (!m) return undefined;
  const t = m[1]?.trim();
  return t && t.length > 0 ? t : undefined;
}

async function executeRead(ctx: MethodExecutionContext): Promise<string | undefined> {
  // P6.§3: manager 已保证 self.type === "feishu_doc"。
  const window = ctx.self as FeishuDocWindow;
  const format = ctx.args.format === "blocks" ? "blocks" : "markdown";

  // 协议：docs +fetch --api-version v2 --doc <token> [--doc-format markdown] [--detail with-ids]
  // 见 lark-doc skill references/lark-doc-fetch.md（与本机 \`lark-cli docs +fetch --help\` 对齐）。
  const args = ["docs", "+fetch", "--api-version", "v2", "--doc", window.docToken];
  if (format === "markdown") {
    args.push("--doc-format", "markdown");
  } else {
    args.push("--doc-format", "xml", "--detail", "with-ids");
  }

  const r = await larkExec(args, { as: "user" });
  if (!r.ok) {
    return `[feishu_doc.read] ${r.error}`;
  }

  // 飞书返回结构：r.data.data.document.{content, document_id, revision_id}
  const doc = pickDocument(r.data);
  const body = doc?.content ?? "";
  const versionId = doc?.revision_id != null ? String(doc.revision_id) : window.versionId;
  const docId = doc?.document_id ?? window.docToken;

  if (format === "markdown") {
    // 飞书 docs +fetch v2 的 markdown 输出把文档标题嵌在内容首部 \`<title>...</title>\`
    // 标签里（document.content 没有独立的 title 字段）。这里抽出来同步到 docTitle / window.title，
    // 让前端 detail / 树节点 / 顶部都能展示真实标题（之前 fallback 是 docToken 尾巴）。
    const extractedTitle = extractMarkdownTitle(body);
    const docTitle = extractedTitle ?? window.docTitle;
    const next: FeishuDocWindow = {
      ...window,
      title: extractedTitle ?? window.title,
      docTitle,
      content: { format: "markdown", body },
      versionId,
      mode: "read",
      lastFetchedAtMs: Date.now(),
    };
    Object.assign(window, next);
    return `已拉取（markdown）${body.length} 字符；revision_id=${versionId ?? "(unknown)"}, doc_id=${docId}, title=${docTitle}。`;
  }

  // blocks (XML with-ids)：内容是 XML 字符串，body 直接放原文，blocks 字段不再尝试解析（用 search_in_doc 在 body 里 grep id 即可）
  const next: FeishuDocWindow = {
    ...window,
    content: { format: "blocks", body },
    versionId,
    mode: "read",
    lastFetchedAtMs: Date.now(),
  };
  Object.assign(window, next);
  return `已拉取（XML with-ids）${body.length} 字符；revision_id=${versionId ?? "(unknown)"}, doc_id=${docId}。`;
}

interface FetchedDoc {
  content?: string;
  document_id?: string;
  revision_id?: number | string;
}

function pickDocument(raw: unknown): FetchedDoc | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const data = r.data as Record<string, unknown> | undefined;
  const doc = data?.document as Record<string, unknown> | undefined;
  if (!doc) return undefined;
  return {
    content: typeof doc.content === "string" ? doc.content : undefined,
    document_id: typeof doc.document_id === "string" ? doc.document_id : undefined,
    revision_id:
      typeof doc.revision_id === "number" || typeof doc.revision_id === "string"
        ? doc.revision_id
        : undefined,
  };
}

function executeSearchInDoc(ctx: MethodExecutionContext): string | undefined {
  // P6.§3: manager 已保证 self.type === "feishu_doc"。
  const window = ctx.self as FeishuDocWindow;
  const query = asString(ctx.args.query);
  if (!query) return "[feishu_doc.search_in_doc] 缺少 query。";
  const limit = Math.min(Math.max(Number(ctx.args.limit) || 10, 1), 100);
  if (!window.content.body) {
    return "[feishu_doc.search_in_doc] window.content 为空，先 read。";
  }
  const lines = window.content.body.split("\n");
  const lower = query.toLowerCase();
  const hits: string[] = [];
  for (let i = 0; i < lines.length && hits.length < limit; i += 1) {
    if (lines[i]!.toLowerCase().includes(lower)) {
      const ctxLine = lines[i]!.length > 80 ? lines[i]!.slice(0, 80) + "…" : lines[i]!;
      hits.push(`L${i + 1}: ${ctxLine}`);
    }
  }
  return hits.length > 0
    ? `命中 ${hits.length} 行：\n${hits.join("\n")}`
    : `未命中 "${query}"。`;
}

async function executeAppend(ctx: MethodExecutionContext): Promise<string | undefined> {
  // P6.§3: manager 已保证 self.type === "feishu_doc"。
  const window = ctx.self as FeishuDocWindow;
  const text = asString(ctx.args.text);
  if (!text) return "[feishu_doc.append] 缺少 text。";
  const confirm = ctx.args.confirm === true;

  // 协议：docs +update --api-version v2 --doc <token> --command append --doc-format markdown --content <text>
  const cliArgs = [
    "docs",
    "+update",
    "--api-version",
    "v2",
    "--doc",
    window.docToken,
    "--command",
    "append",
    "--doc-format",
    "markdown",
    "--content",
    text,
  ];

  if (!confirm) {
    const dry = await larkExec(cliArgs, { as: "user", dryRun: true });
    if (!dry.ok) return `[feishu_doc.append dry-run] ${dry.error}`;
    return `dry-run 预览成功；refine(args={ confirm: true }) 后再 submit。\ndoc=${window.docToken}, append 长度=${text.length}\n预览：${truncate(dry.raw, 512)}`;
  }
  const real = await larkExec([...cliArgs, "--yes"], { as: "user" });
  if (!real.ok) return `[feishu_doc.append] ${real.error}`;
  return `已追加（doc=${window.docToken}, +${text.length} 字符）。`;
}

async function executePatchBlock(ctx: MethodExecutionContext): Promise<string | undefined> {
  // P6.§3: manager 已保证 self.type === "feishu_doc"。
  const window = ctx.self as FeishuDocWindow;
  const blockId = asString(ctx.args.block_id);
  const op = asString(ctx.args.op);
  if (!blockId) return "[feishu_doc.patch_block] 缺少 block_id。";
  if (!op || !["replace_text", "insert_after", "delete"].includes(op)) {
    return "[feishu_doc.patch_block] op 必须为 replace_text | insert_after | delete。";
  }
  const text = asString(ctx.args.text);
  if (op !== "delete" && !text) {
    return "[feishu_doc.patch_block] op=replace_text/insert_after 时必须提供 text。";
  }
  const confirm = ctx.args.confirm === true;
  const expectedVersion = asString(ctx.args.expected_version);

  if (confirm) {
    if (!expectedVersion) {
      return "[feishu_doc.patch_block] confirm 提交时必须提供 expected_version（来自 dry-run 时记录的 versionId / revision_id）。";
    }
    if (window.versionId && window.versionId !== expectedVersion) {
      return `[feishu_doc.patch_block] 版本飘移：window.versionId=${window.versionId}，expected_version=${expectedVersion}；请重新 read 并核对再 patch。`;
    }
  }

  // 协议映射：
  //   replace_text  → --command block_replace      (整块替换，--content 给完整新块的 XML / Markdown)
  //   insert_after  → --command block_insert_after (在 block-id 之后新增；--content 是新块内容)
  //   delete        → --command block_delete       (无需 --content)
  const commandName =
    op === "replace_text" ? "block_replace" : op === "insert_after" ? "block_insert_after" : "block_delete";

  const cliArgs = [
    "docs",
    "+update",
    "--api-version",
    "v2",
    "--doc",
    window.docToken,
    "--command",
    commandName,
    "--block-id",
    blockId,
  ];
  if (text && commandName !== "block_delete") {
    // doc-format 默认 xml；text 既可以是 markdown 也可以是 xml，让 LLM 自己拼。
    cliArgs.push("--doc-format", "markdown", "--content", text);
  }
  if (expectedVersion) {
    cliArgs.push("--revision-id", expectedVersion);
  }

  if (!confirm) {
    const dry = await larkExec(cliArgs, { as: "user", dryRun: true });
    if (!dry.ok) return `[feishu_doc.patch_block dry-run] ${dry.error}`;
    return `dry-run 预览成功；如要真改，refine(args={ confirm: true, expected_version: "${window.versionId ?? "<UNKNOWN>"}" }) 后再 submit。\nblock_id=${blockId}, op=${op} → ${commandName}\n预览：${truncate(dry.raw, 512)}`;
  }
  const real = await larkExec([...cliArgs, "--yes"], { as: "user" });
  if (!real.ok) return `[feishu_doc.patch_block] ${real.error}`;
  return `已 patch（block_id=${blockId}, op=${op} → ${commandName}）。`;
}

async function executeShareLink(ctx: MethodExecutionContext): Promise<string | undefined> {
  // P6.§3: manager 已保证 self.type === "feishu_doc"。
  const window = ctx.self as FeishuDocWindow;
  // 租户 host 由 .world.json 的 LarkTenantHost 字段配置（默认 feishu.cn）。
  // 私有部署 / 公海版 / 国际版用户必须配，否则链接 404。
  const baseDir = ctx.thread?.persistence?.baseDir;
  const tenantHost = baseDir
    ? (await readWorldConfig(baseDir)).larkTenantHost
    : DEFAULT_LARK_TENANT_HOST;
  const slug =
    window.docKind === "wiki"
      ? `wiki/${window.docToken}`
      : window.docKind === "docx"
        ? `docx/${window.docToken}`
        : window.docKind === "sheet"
          ? `sheets/${window.docToken}`
          : window.docKind === "base"
            ? `base/${window.docToken}`
            : window.docKind === "drive_md"
              ? `file/${window.docToken}`
              : `docs/${window.docToken}`;
  return `https://${tenantHost}/${slug}`;
}

async function executeAttachToChat(ctx: MethodExecutionContext): Promise<string | undefined> {
  // P6.§3: manager 已保证 self.type === "feishu_doc"。
  const window = ctx.self as FeishuDocWindow;
  const chatId = asString(ctx.args.chat_id);
  if (!chatId) return "[feishu_doc.attach_to_chat] 缺少 chat_id。";
  const comment = asString(ctx.args.comment);
  const confirm = ctx.args.confirm === true;
  const as = (ctx.args.as === "user" ? "user" : "bot") as "bot" | "user";

  // 拼一个 link 文本走 im +messages-send；走 executeShareLink 复用 LarkTenantHost 解析。
  const linkOrErr = await executeShareLink(ctx);
  const link = typeof linkOrErr === "string" && linkOrErr.startsWith("https://")
    ? linkOrErr
    : `https://${DEFAULT_LARK_TENANT_HOST}/docs/${window.docToken}`;
  const text = comment ? `${comment}\n${link}` : link;
  const cliArgs = ["im", "+messages-send", "--chat-id", chatId, "--text", text];

  if (!confirm) {
    const dry = await larkExec(cliArgs, { as, dryRun: true });
    if (!dry.ok) return `[feishu_doc.attach_to_chat dry-run] ${dry.error}`;
    return `dry-run 预览成功；refine(args={ confirm: true }) 后再 submit。\nchat=${chatId}, link=${link}\n预览：${truncate(dry.raw, 512)}`;
  }
  const real = await larkExec([...cliArgs, "--yes"], { as });
  if (!real.ok) return `[feishu_doc.attach_to_chat] ${real.error}`;
  return `已发送链接到 chat=${chatId}（as=${as}）。`;
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + `…(${text.length - max} more bytes)`;
}

// ─────────────────────────── render ────────────────────────────

function renderFeishuDoc(ctx: RenderContext): XmlNode[] {
  const w = ctx.window as FeishuDocWindow;
  const children: XmlNode[] = [
    xmlElement("doc_token", {}, [xmlText(w.docToken)]),
    xmlElement("doc_kind", {}, [xmlText(w.docKind)]),
    xmlElement("doc_title", {}, [xmlText(w.docTitle)]),
    xmlElement("mode", {}, [xmlText(w.mode)]),
    xmlElement("content_format", {}, [xmlText(w.content.format)]),
  ];
  if (w.versionId) children.push(xmlElement("version_id", {}, [xmlText(w.versionId)]));
  if (w.lastFetchedAtMs) {
    children.push(xmlElement("last_fetched", {}, [xmlText(new Date(w.lastFetchedAtMs).toISOString())]));
  }
  const body = w.content.body || "(尚未 read，content 为空)";
  children.push(xmlElement("content", {}, [xmlText(truncateBytes(body, MAX_RENDER_BYTES))]));
  return children;
}

builtinRegistry.registerObjectType("feishu_doc", {
  methods: {
    read: readMethod,
    search_in_doc: searchInDocMethod,
    append: appendMethod,
    patch_block: patchBlockMethod,
    share_link: shareLinkMethod,
    attach_to_chat: attachToChatMethod,
    close: closeMethod,
  },
  renderXml: renderFeishuDoc,
  basicKnowledge: PROTOCOL_KNOWLEDGE,
});
