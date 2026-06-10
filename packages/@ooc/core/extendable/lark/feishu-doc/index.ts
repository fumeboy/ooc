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
import { xmlElement, xmlText, truncateBytes, type XmlNode } from "@ooc/core/_shared/types/xml.js";
import { larkExec } from "../cli.js";
import { readWorldConfig, DEFAULT_LARK_TENANT_HOST } from "../../../persistable/index.js";

const MAX_RENDER_BYTES = 12288;

const READ_TIP = `feishu_doc.read 拉取文档内容到 window.content。
参数：format（可选 "markdown"|"blocks"，默认 markdown）。`;

const SEARCH_TIP = `feishu_doc.search_in_doc 在已 read 的 content 内查找关键字。
参数：query（必填）、limit（可选，默认 10）。`;

const APPEND_TIP = `feishu_doc.append 在文档末尾追加（dry-run gate）。
参数：text（必填）、confirm（true 才真追加；首次 submit dry-run）。`;

const PATCH_TIP = `feishu_doc.patch_block 修改/插入 block（dry-run + version 检查）。
参数：block_id（必填）、op（replace_text|insert_after|delete）、text、confirm、expected_version。`;

const SHARE_TIP = `feishu_doc.share_link 返回文档可分享 URL（无参数）。`;

const ATTACH_TIP = `feishu_doc.attach_to_chat 把文档链接发到群（dry-run gate）。
参数：chat_id（必填）、comment（可选）、confirm、as。`;

// ─────────────────────────── method 实现 ────────────────────────────

const readMethod: ObjectMethod = {
  description: "Read the Feishu doc content into window.content.",
  intents: ["read"],
  schema: {
    args: {
      format: { type: "string", enum: ["markdown", "blocks"], description: "输出格式，默认 markdown" },
    },
  },
  onFormChange() {
    return { tip: READ_TIP, intents: [{ name: "read" }], quick_exec_submit: true };
  },
  exec: (ctx) => executeRead(ctx),
};

const searchInDocMethod: ObjectMethod = {
  description: "Search within the already-read document content.",
  intents: ["search_in_doc"],
  schema: {
    args: {
      query: { type: "string", required: true, description: "搜索关键字" },
      limit: { type: "number", description: "最多返回行数" },
    },
  },
  onFormChange(change, { args }) {
    const hasQuery = typeof args.query === "string" && args.query.length > 0;
    return {
      tip: hasQuery ? `Searching for ${args.query}...` : SEARCH_TIP,
      intents: [{ name: "search_in_doc" }],
      quick_exec_submit: hasQuery,
    };
  },
  exec: (ctx) => executeSearchInDoc(ctx),
};

const appendMethod: ObjectMethod = {
  description: "Append content to the end of the doc (dry-run first; confirm=true to apply).",
  intents: ["append.confirmed"],
  schema: {
    args: {
      text: { type: "string", required: true, description: "待追加 markdown" },
      confirm: { type: "boolean", description: "true 才真追加" },
    },
  },
  onFormChange(change, { args }) {
    const intents = args.confirm === true ? [{ name: "append.confirmed" }] : [{ name: "append" }];
    const hasText = typeof args.text === "string" && args.text.length > 0;
    let tip = APPEND_TIP;
    if (hasText && args.confirm !== true) tip = "已提供 text；submit 将 dry-run。refine({confirm:true}) 后再 submit 才真追加。";
    return { tip, intents, quick_exec_submit: hasText };
  },
  exec: (ctx) => executeAppend(ctx),
};

const patchBlockMethod: ObjectMethod = {
  description: "Patch a specific block in the doc (dry-run + version check; confirm=true to apply).",
  intents: ["patch_block.confirmed"],
  schema: {
    args: {
      block_id: { type: "string", required: true, description: "目标 block id" },
      op: { type: "string", required: true, enum: ["replace_text", "insert_after", "delete"] },
      text: { type: "string", description: "replace_text/insert_after 时必填" },
      confirm: { type: "boolean" },
      expected_version: { type: "string", description: "dry-run 返回的 versionId" },
    },
  },
  onFormChange(change, { args }) {
    const intents = args.confirm === true ? [{ name: "patch_block.confirmed" }] : [{ name: "patch_block" }];
    const hasBlock = typeof args.block_id === "string" && args.block_id.length > 0;
    let tip = PATCH_TIP;
    if (hasBlock && args.confirm !== true) tip = "submit 将 dry-run；refine({confirm:true, expected_version}) 后再 submit 才真改。";
    return { tip, intents, quick_exec_submit: hasBlock };
  },
  exec: (ctx) => executePatchBlock(ctx),
};

const shareLinkMethod: ObjectMethod = {
  description: "Get a shareable URL for this doc.",
  intents: ["share_link"],
  onFormChange() {
    return { tip: SHARE_TIP, intents: [{ name: "share_link" }], quick_exec_submit: true };
  },
  exec: (ctx) => executeShareLink(ctx),
};

const attachToChatMethod: ObjectMethod = {
  description: "Send this doc as a link to a Feishu chat (dry-run first; confirm=true to send).",
  intents: ["attach_to_chat.confirmed"],
  schema: {
    args: {
      chat_id: { type: "string", required: true, description: "目标 chat_id" },
      comment: { type: "string", description: "附加文本" },
      confirm: { type: "boolean" },
      as: { type: "string", enum: ["bot", "user"] },
    },
  },
  onFormChange(change, { args }) {
    const intents = args.confirm === true ? [{ name: "attach_to_chat.confirmed" }] : [{ name: "attach_to_chat" }];
    const hasChat = typeof args.chat_id === "string" && args.chat_id.length > 0;
    let tip = ATTACH_TIP;
    if (hasChat && args.confirm !== true) tip = "submit 将 dry-run；refine({confirm:true}) 后再 submit 才真发。";
    return { tip, intents, quick_exec_submit: hasChat };
  },
  exec: (ctx) => executeAttachToChat(ctx),
};

const closeMethod: ObjectMethod = {
  description: "Close this Feishu doc window.",
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
  // P6.§3: manager 已保证 self.class === "feishu_doc"。
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
  // P6.§3: manager 已保证 self.class === "feishu_doc"。
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
  // P6.§3: manager 已保证 self.class === "feishu_doc"。
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
  // P6.§3: manager 已保证 self.class === "feishu_doc"。
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
  // P6.§3: manager 已保证 self.class === "feishu_doc"。
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
  // P6.§3: manager 已保证 self.class === "feishu_doc"。
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

builtinRegistry.registerExecutable("feishu_doc", {
  methods: {
    read: readMethod,
    search_in_doc: searchInDocMethod,
    append: appendMethod,
    patch_block: patchBlockMethod,
    share_link: shareLinkMethod,
    attach_to_chat: attachToChatMethod,
    close: closeMethod,
  },
});
builtinRegistry.registerReadable("feishu_doc", {
  readable: renderFeishuDoc,
});
