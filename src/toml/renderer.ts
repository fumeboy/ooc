/**
 * TOML 渲染器 (G5, Phase 2)
 *
 * 将 Context 对象转换为 TOML 格式的 system prompt。
 * TOML 格式比原有的标记分隔格式更清晰、更结构化。
 *
 * @ref docs/哲学文档/gene.md#G5 — references — Context 格式化
 */

import { stringify } from "smol-toml";
import type { Context, ContextWindow, DirectoryEntry, FlowMessage } from "../types/index.js";

/**
 * 多行字符串渲染辅助函数
 * 对于多行文本，使用 TOML 的 '''...''' 语法
 */
function toMultilineString(s: string): string {
  if (!s) return '""';
  // 如果包含换行符，使用多行字符串语法
  if (s.includes("\n")) {
    // 转义 ''' 序列（如果存在）
    const escaped = s.replace(/'''/g, "\\'''");
    return `'''${escaped}'''`;
  }
  // 单行字符串
  return JSON.stringify(s);
}

/**
 * 构建 TOML 格式的 identity 部分
 */
function buildIdentity(ctx: Context): Record<string, unknown> {
  return {
    name: ctx.name,
    who_am_i: ctx.whoAmI,
  };
}

/**
 * 构建 TOML 格式的 instructions 部分
 */
function buildInstructions(windows: ContextWindow[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const w of windows) {
    result[w.name] = w.content;
  }
  return result;
}

/**
 * 从 ctx.knowledge 中提取特殊窗口
 */
interface KnowledgeWindows {
  traitCatalog: string | undefined;
  mirror: string | undefined;
  longTermMemory: string | undefined;
  sessionMemory: string | undefined;
  recentConversations: string | undefined;
  sessionOverview: string | undefined;
  sessionMessages: string | undefined;
  dynamicWindows: Array<{ name: string; content: string }>;
}

/**
 * 提取特殊窗口
 */
function extractKnowledgeWindows(windows: ContextWindow[]): KnowledgeWindows {
  const result: KnowledgeWindows = {
    traitCatalog: undefined,
    mirror: undefined,
    longTermMemory: undefined,
    sessionMemory: undefined,
    recentConversations: undefined,
    sessionOverview: undefined,
    sessionMessages: undefined,
    dynamicWindows: [],
  };

  for (const w of windows) {
    switch (w.name) {
      case "_trait_catalog":
        result.traitCatalog = w.content;
        break;
      case "mirror":
        result.mirror = w.content;
        break;
      case "long-term-memory":
        result.longTermMemory = w.content;
        break;
      case "session-memory":
        result.sessionMemory = w.content;
        break;
      case "recent-conversations":
        result.recentConversations = w.content;
        break;
      case "_session_overview":
        result.sessionOverview = w.content;
        break;
      case "_session_messages":
        result.sessionMessages = w.content;
        break;
      default:
        // 跳过名称包含 "/" 的（user traits，已在 buildTraits 中处理）
        if (!w.name.includes("/")) {
          result.dynamicWindows.push({ name: w.name, content: w.content });
        }
        break;
    }
  }

  return result;
}

/**
 * 构建 TOML 格式的 traits 部分
 * 独立的 traits 段落，不再混在 knowledge 中
 */
function buildTraits(windows: ContextWindow[]): Record<string, unknown> {
  const active: Record<string, string> = {};

  for (const w of windows) {
    // 简单分类：trait name 包含 "/" 的认为是用户 trait
    if (w.name.includes("/")) {
      active[w.name] = w.content;
    }
  }

  const result: Record<string, unknown> = {};
  if (Object.keys(active).length > 0) {
    result.active = active;
  }

  return result;
}

/**
 * 构建 TOML 格式的 directory 部分
 */
function buildDirectory(entries: DirectoryEntry[]): Array<Record<string, unknown>> {
  return entries.map((e) => ({
    name: e.name,
    who_am_i: e.whoAmI,
    functions: e.functions.map((f) => ({
      name: f.name,
      description: f.description,
    })),
  }));
}

/**
 * 构建 TOML 格式的 messages 部分
 */
function buildMessages(messages: FlowMessage[]): Array<Record<string, unknown>> {
  return messages.map((m) => ({
    id: m.id,
    from: m.from,
    to: m.to,
    direction: m.direction,
    content: m.content,
    timestamp: m.timestamp,
  }));
}

/**
 * 构建 TOML 格式的 paths 部分
 */
function buildPaths(paths?: Record<string, string>): Record<string, string> | undefined {
  if (!paths || Object.keys(paths).length === 0) return undefined;
  return paths;
}

/**
 * 将 Context 转换为 TOML 对象
 */
export function contextToTomlObject(ctx: Context): Record<string, unknown> {
  const result: Record<string, unknown> = {
    _version: "2.0",
    _format: "toml",
  };

  result.identity = buildIdentity(ctx);

  if (ctx.instructions.length > 0) {
    result.instructions = buildInstructions(ctx.instructions);
  }

  // 提取特殊窗口
  const kw = extractKnowledgeWindows(ctx.knowledge);

  // 构建 traits 部分
  const traitsSection = buildTraits(ctx.knowledge);
  if (Object.keys(traitsSection).length > 0) {
    result.traits = traitsSection;
  }

  // 添加 trait catalog
  if (kw.traitCatalog) {
    result.trait_catalog = kw.traitCatalog;
  }

  // 添加 mirror
  if (kw.mirror) {
    result.mirror = kw.mirror;
  }

  // 添加 memory
  const memory: Record<string, string> = {};
  if (kw.longTermMemory) memory["long-term"] = kw.longTermMemory;
  if (kw.sessionMemory) memory.session = kw.sessionMemory;
  if (kw.recentConversations) memory["recent-conversations"] = kw.recentConversations;
  if (Object.keys(memory).length > 0) {
    result.memory = memory;
  }

  // 添加 session overview
  if (kw.sessionOverview) {
    result.session_overview = kw.sessionOverview;
  }
  if (kw.sessionMessages) {
    result.session_messages = kw.sessionMessages;
  }

  // 添加动态窗口
  if (kw.dynamicWindows.length > 0) {
    const dynamic: Record<string, string> = {};
    for (const w of kw.dynamicWindows) {
      dynamic[w.name] = w.content;
    }
    result.dynamic = dynamic;
  }

  if (ctx.directory.length > 0) {
    result.directory = buildDirectory(ctx.directory);
  }

  if (ctx.process) {
    result.process = ctx.process;
  }

  result.status = ctx.status;

  const paths = buildPaths(ctx.paths);
  if (paths) {
    result.paths = paths;
  }

  if (ctx.messages.length > 0) {
    result.messages = buildMessages(ctx.messages);
  }

  return result;
}

/**
 * 将 Context 格式化为 TOML 字符串
 *
 * @param ctx - Context 对象
 * @returns TOML 格式的字符串
 */
export function formatContextAsToml(ctx: Context): string {
  const obj = contextToTomlObject(ctx);

  const lines: string[] = [];

  // 头部注释
  lines.push("# OOC Context");
  lines.push(`# 版本: ${obj._version as string}`);
  lines.push(`# 生成时间: ${new Date().toISOString()}`);
  lines.push("");

  // identity 部分
  if (obj.identity) {
    lines.push("[identity]");
    const id = obj.identity as Record<string, unknown>;
    if (id.name) lines.push(`name = ${JSON.stringify(id.name)}`);
    if (id.who_am_i) {
      lines.push(`who_am_i = ${toMultilineString(id.who_am_i as string)}`);
    }
    lines.push("");
  }

  // instructions 部分
  if (obj.instructions) {
    const instr = obj.instructions as Record<string, string>;
    for (const [key, value] of Object.entries(instr)) {
      lines.push(`[instructions.${key}]`);
      lines.push(`content = ${toMultilineString(value)}`);
      lines.push("");
    }
  }

  // traits 部分
  if (obj.traits) {
    const traits = obj.traits as Record<string, Record<string, string>>;
    if (traits.active) {
      lines.push("[traits.active]");
      for (const [key, value] of Object.entries(traits.active)) {
        // 嵌套的 key 可能是 "lark/wiki" 这样的形式
        // 需要用点分隔的表格形式
        const safeKey = key.replace(/\//g, ".");
        lines.push(`[traits.active.${safeKey}]`);
        lines.push(`content = ${toMultilineString(value)}`);
        lines.push("");
      }
    }
  }

  // trait_catalog 部分（可激活的 trait 目录）
  if (obj.trait_catalog) {
    lines.push("[trait_catalog]");
    lines.push(`content = ${toMultilineString(obj.trait_catalog as string)}`);
    lines.push("");
  }

  // mirror 部分（行为观察窗口）
  if (obj.mirror) {
    lines.push("[mirror]");
    lines.push(`content = ${toMultilineString(obj.mirror as string)}`);
    lines.push("");
  }

  // memory 部分
  if (obj.memory) {
    const memory = obj.memory as Record<string, string>;
    if (memory["long-term"]) {
      lines.push("[memory.long-term]");
      lines.push(`content = ${toMultilineString(memory["long-term"])}`);
      lines.push("");
    }
    if (memory.session) {
      lines.push("[memory.session]");
      lines.push(`content = ${toMultilineString(memory.session)}`);
      lines.push("");
    }
    if (memory["recent-conversations"]) {
      lines.push("[memory.recent-conversations]");
      lines.push(`content = ${toMultilineString(memory["recent-conversations"])}`);
      lines.push("");
    }
  }

  // session_overview 部分
  if (obj.session_overview) {
    lines.push("[session_overview]");
    lines.push(`content = ${toMultilineString(obj.session_overview as string)}`);
    lines.push("");
  }

  // session_messages 部分
  if (obj.session_messages) {
    lines.push("[session_messages]");
    lines.push(`content = ${toMultilineString(obj.session_messages as string)}`);
    lines.push("");
  }

  // dynamic 部分（动态窗口）
  if (obj.dynamic) {
    const dynamic = obj.dynamic as Record<string, string>;
    for (const [key, value] of Object.entries(dynamic)) {
      lines.push(`[dynamic.${key}]`);
      lines.push(`content = ${toMultilineString(value)}`);
      lines.push("");
    }
  }

  // directory 部分
  if (obj.directory) {
    lines.push("[directory]");
    lines.push("");
    const dir = obj.directory as Array<Record<string, unknown>>;
    for (let i = 0; i < dir.length; i++) {
      const entry = dir[i]!;
      lines.push(`[[directory.objects]]`);
      lines.push(`name = ${JSON.stringify(entry.name as string)}`);
      lines.push(`who_am_i = ${JSON.stringify(entry.who_am_i as string)}`);
      if (entry.functions && Array.isArray(entry.functions)) {
        const funcs = entry.functions as Array<Record<string, string>>;
        for (const f of funcs) {
          lines.push("");
          lines.push(`[[directory.objects.functions]]`);
          lines.push(`name = ${JSON.stringify(f.name)}`);
          lines.push(`description = ${JSON.stringify(f.description)}`);
        }
      }
      lines.push("");
    }
  }

  // process 部分
  if (obj.process) {
    lines.push("[process]");
    lines.push(`content = ${toMultilineString(obj.process as string)}`);
    lines.push("");
  }

  // status 部分
  lines.push("[status]");
  lines.push(`value = ${JSON.stringify(obj.status as string)}`);
  lines.push("");

  // paths 部分
  if (obj.paths) {
    lines.push("[paths]");
    const paths = obj.paths as Record<string, string>;
    for (const [key, value] of Object.entries(paths)) {
      lines.push(`${key} = ${JSON.stringify(value)}`);
    }
    lines.push("");
  }

  // messages 部分
  if (obj.messages) {
    lines.push("[messages]");
    lines.push("");
    const msgs = obj.messages as Array<Record<string, unknown>>;
    for (const msg of msgs) {
      lines.push(`[[messages.items]]`);
      if (msg.id) lines.push(`id = ${JSON.stringify(msg.id as string)}`);
      lines.push(`from = ${JSON.stringify(msg.from as string)}`);
      lines.push(`to = ${JSON.stringify(msg.to as string)}`);
      lines.push(`direction = ${JSON.stringify(msg.direction as string)}`);
      lines.push(`content = ${toMultilineString(msg.content as string)}`);
      lines.push(`timestamp = ${msg.timestamp as number}`);
      lines.push("");
    }
  }

  return lines.join("\n");
}

/**
 * 简化版 TOML 格式化（备选方案）
 * 使用 smol-toml 的 stringify 自动处理
 */
export function formatContextAsTomlSimple(ctx: Context): string {
  const obj = contextToTomlObject(ctx);
  try {
    return stringify(obj);
  } catch {
    // 如果自动 stringify 失败，使用手动构建的版本
    return formatContextAsToml(ctx);
  }
}
