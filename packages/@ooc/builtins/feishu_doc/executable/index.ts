/**
 * feishu_doc —— executable 维度（object method）。
 *
 * object method 签名 `(ctx, self, args)`，直接读写 self（飞书文档业务 Data）、可副作用
 * （经 larkExec 调 lark-cli）。需 world 配置（租户 host）时从 ctx.thread.persistence.baseDir 取。
 * 与 readable 维度（投影 + window method，在 ../readable/index.ts）物理分离。
 *
 * object methods：
 * - read：拉文档全文 / 段落到 content（无副作用）
 * - search_in_doc：已 read 内容内查找（无副作用，不改 content）
 * - append：文档末尾追加（**强制 dry-run gate**）
 * - patch_block：修改 / 插入 block（**强制 dry-run gate** + versionId 检查）
 * - share_link：返回 doc 可分享 URL（无副作用）
 * - attach_to_chat：把 doc 链接发到 chat（**强制 dry-run gate**）
 * - close：释放对象
 *
 * 鉴权：默认 user（飞书文档读写需用户授权）；attach_to_chat 默认 bot。
 */

import type {
  ExecutableContext,
  ObjectMethod,
  ExecutableModule,
} from "@ooc/core/executable/contract.js";
import { larkExec } from "@ooc/builtins/feishu_app/cli.js";
import { readWorldConfig, DEFAULT_LARK_TENANT_HOST } from "@ooc/core/persistable";
import type { Data } from "../types.js";

const readMethod: ObjectMethod<Data> = {
  name: "read",
  description: "Read the Feishu doc content into window.content.",
  schema: {
    args: {
      format: { type: "string", enum: ["markdown", "blocks"], description: "输出格式，默认 markdown" },
    },
  },
  exec: (_ctx, self, args) => executeRead(self, args),
};

const searchInDocMethod: ObjectMethod<Data> = {
  name: "search_in_doc",
  description: "Search within the already-read document content.",
  schema: {
    args: {
      query: { type: "string", required: true, description: "搜索关键字" },
      limit: { type: "number", description: "最多返回行数" },
    },
  },
  exec: (_ctx, self, args) => executeSearchInDoc(self, args),
};

const appendMethod: ObjectMethod<Data> = {
  name: "append",
  description: "Append content to the end of the doc (dry-run first; confirm=true to apply).",
  schema: {
    args: {
      text: { type: "string", required: true, description: "待追加 markdown" },
      confirm: { type: "boolean", description: "true 才真追加" },
    },
  },
  exec: (_ctx, self, args) => executeAppend(self, args),
};

const patchBlockMethod: ObjectMethod<Data> = {
  name: "patch_block",
  description: "Patch a specific block in the doc (dry-run + version check; confirm=true to apply).",
  schema: {
    args: {
      block_id: { type: "string", required: true, description: "目标 block id" },
      op: { type: "string", required: true, enum: ["replace_text", "insert_after", "delete"] },
      text: { type: "string", description: "replace_text/insert_after 时必填" },
      confirm: { type: "boolean" },
      expected_version: { type: "string", description: "dry-run 返回的 versionId" },
    },
  },
  exec: (_ctx, self, args) => executePatchBlock(self, args),
};

const shareLinkMethod: ObjectMethod<Data> = {
  name: "share_link",
  description: "Get a shareable URL for this doc.",
  exec: (ctx, self) => executeShareLink(ctx, self),
};

const attachToChatMethod: ObjectMethod<Data> = {
  name: "attach_to_chat",
  description: "Send this doc as a link to a Feishu chat (dry-run first; confirm=true to send).",
  schema: {
    args: {
      chat_id: { type: "string", required: true, description: "目标 chat_id" },
      comment: { type: "string", description: "附加文本" },
      confirm: { type: "boolean" },
      as: { type: "string", enum: ["bot", "user"] },
    },
  },
  exec: (ctx, self, args) => executeAttachToChat(ctx, self, args),
};

const closeMethod: ObjectMethod<Data> = {
  name: "close",
  description: "Close this Feishu doc window.",
  exec: () => undefined,
};

// ─────────────────────────── helpers ────────────────────────────

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * 从飞书 markdown 输出抽取文档标题（嵌在首部 `<title>...</title>` 标签）。
 * 没找到返回 undefined（保留调用方的 fallback 行为）。
 */
function extractMarkdownTitle(body: string): string | undefined {
  if (!body) return undefined;
  const m = body.match(/<title>([\s\S]*?)<\/title>/i);
  if (!m) return undefined;
  const t = m[1]?.trim();
  return t && t.length > 0 ? t : undefined;
}

async function executeRead(self: Data, args: Record<string, unknown>): Promise<string | undefined> {
  const format = args.format === "blocks" ? "blocks" : "markdown";

  const cliArgs = ["docs", "+fetch", "--api-version", "v2", "--doc", self.docToken];
  if (format === "markdown") {
    cliArgs.push("--doc-format", "markdown");
  } else {
    cliArgs.push("--doc-format", "xml", "--detail", "with-ids");
  }

  const r = await larkExec(cliArgs, { as: "user" });
  if (!r.ok) return `[feishu_doc.read] ${r.error}`;

  const doc = pickDocument(r.data);
  const body = doc?.content ?? "";
  const versionId = doc?.revision_id != null ? String(doc.revision_id) : self.versionId;
  const docId = doc?.document_id ?? self.docToken;

  if (format === "markdown") {
    const extractedTitle = extractMarkdownTitle(body);
    const docTitle = extractedTitle ?? self.docTitle;
    self.docTitle = docTitle;
    self.content = { format: "markdown", body };
    self.versionId = versionId;
    self.mode = "read";
    self.lastFetchedAtMs = Date.now();
    return `已拉取（markdown）${body.length} 字符；revision_id=${versionId ?? "(unknown)"}, doc_id=${docId}, title=${docTitle}。`;
  }

  self.content = { format: "blocks", body };
  self.versionId = versionId;
  self.mode = "read";
  self.lastFetchedAtMs = Date.now();
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

function executeSearchInDoc(self: Data, args: Record<string, unknown>): string | undefined {
  const query = asString(args.query);
  if (!query) return "[feishu_doc.search_in_doc] 缺少 query。";
  const limit = Math.min(Math.max(Number(args.limit) || 10, 1), 100);
  if (!self.content.body) {
    return "[feishu_doc.search_in_doc] window.content 为空，先 read。";
  }
  const lines = self.content.body.split("\n");
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

async function executeAppend(self: Data, args: Record<string, unknown>): Promise<string | undefined> {
  const text = asString(args.text);
  if (!text) return "[feishu_doc.append] 缺少 text。";
  const confirm = args.confirm === true;

  const cliArgs = [
    "docs",
    "+update",
    "--api-version",
    "v2",
    "--doc",
    self.docToken,
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
    return `dry-run 预览成功；refine(args={ confirm: true }) 后再 submit。\ndoc=${self.docToken}, append 长度=${text.length}\n预览：${truncate(dry.raw, 512)}`;
  }
  const real = await larkExec([...cliArgs, "--yes"], { as: "user" });
  if (!real.ok) return `[feishu_doc.append] ${real.error}`;
  return `已追加（doc=${self.docToken}, +${text.length} 字符）。`;
}

async function executePatchBlock(self: Data, args: Record<string, unknown>): Promise<string | undefined> {
  const blockId = asString(args.block_id);
  const op = asString(args.op);
  if (!blockId) return "[feishu_doc.patch_block] 缺少 block_id。";
  if (!op || !["replace_text", "insert_after", "delete"].includes(op)) {
    return "[feishu_doc.patch_block] op 必须为 replace_text | insert_after | delete。";
  }
  const text = asString(args.text);
  if (op !== "delete" && !text) {
    return "[feishu_doc.patch_block] op=replace_text/insert_after 时必须提供 text。";
  }
  const confirm = args.confirm === true;
  const expectedVersion = asString(args.expected_version);

  if (confirm) {
    if (!expectedVersion) {
      return "[feishu_doc.patch_block] confirm 提交时必须提供 expected_version（来自 dry-run 时记录的 versionId / revision_id）。";
    }
    if (self.versionId && self.versionId !== expectedVersion) {
      return `[feishu_doc.patch_block] 版本飘移：window.versionId=${self.versionId}，expected_version=${expectedVersion}；请重新 read 并核对再 patch。`;
    }
  }

  const commandName =
    op === "replace_text" ? "block_replace" : op === "insert_after" ? "block_insert_after" : "block_delete";

  const cliArgs = [
    "docs",
    "+update",
    "--api-version",
    "v2",
    "--doc",
    self.docToken,
    "--command",
    commandName,
    "--block-id",
    blockId,
  ];
  if (text && commandName !== "block_delete") {
    cliArgs.push("--doc-format", "markdown", "--content", text);
  }
  if (expectedVersion) {
    cliArgs.push("--revision-id", expectedVersion);
  }

  if (!confirm) {
    const dry = await larkExec(cliArgs, { as: "user", dryRun: true });
    if (!dry.ok) return `[feishu_doc.patch_block dry-run] ${dry.error}`;
    return `dry-run 预览成功；如要真改，refine(args={ confirm: true, expected_version: "${self.versionId ?? "<UNKNOWN>"}" }) 后再 submit。\nblock_id=${blockId}, op=${op} → ${commandName}\n预览：${truncate(dry.raw, 512)}`;
  }
  const real = await larkExec([...cliArgs, "--yes"], { as: "user" });
  if (!real.ok) return `[feishu_doc.patch_block] ${real.error}`;
  return `已 patch（block_id=${blockId}, op=${op} → ${commandName}）。`;
}

async function executeShareLink(ctx: ExecutableContext, self: Data): Promise<string | undefined> {
  // 租户 host 由 .world.json 的 LarkTenantHost 字段配置（默认 feishu.cn）。
  const baseDir = ctx.thread?.persistence?.baseDir;
  const tenantHost = baseDir
    ? (await readWorldConfig(baseDir)).larkTenantHost
    : DEFAULT_LARK_TENANT_HOST;
  const slug =
    self.docKind === "wiki"
      ? `wiki/${self.docToken}`
      : self.docKind === "docx"
        ? `docx/${self.docToken}`
        : self.docKind === "sheet"
          ? `sheets/${self.docToken}`
          : self.docKind === "base"
            ? `base/${self.docToken}`
            : self.docKind === "drive_md"
              ? `file/${self.docToken}`
              : `docs/${self.docToken}`;
  return `https://${tenantHost}/${slug}`;
}

async function executeAttachToChat(
  ctx: ExecutableContext,
  self: Data,
  args: Record<string, unknown>,
): Promise<string | undefined> {
  const chatId = asString(args.chat_id);
  if (!chatId) return "[feishu_doc.attach_to_chat] 缺少 chat_id。";
  const comment = asString(args.comment);
  const confirm = args.confirm === true;
  const as = (args.as === "user" ? "user" : "bot") as "bot" | "user";

  const linkOrErr = await executeShareLink(ctx, self);
  const link = typeof linkOrErr === "string" && linkOrErr.startsWith("https://")
    ? linkOrErr
    : `https://${DEFAULT_LARK_TENANT_HOST}/docs/${self.docToken}`;
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

const executable: ExecutableModule<Data> = {
  methods: [
    readMethod,
    searchInDocMethod,
    appendMethod,
    patchBlockMethod,
    shareLinkMethod,
    attachToChatMethod,
    closeMethod,
  ],
};

export default executable;
