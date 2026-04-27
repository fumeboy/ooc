/**
 * Memory Entries —— 结构化长期记忆条目存储
 *
 * 目标（Memory Curation 迭代 Phase 1）：
 * - 把扁平 append-only `memory.md` 升级为可索引、可去重、可过期的结构化存储
 * - 新条目落 `{selfDir}/memory/entries/{id}.json`
 * - 保留老 `{selfDir}/memory.md` 作为 readonly snapshot（兼容 + 不破坏 Bruce 测试）
 * - 提供迁移函数：解析 memory.md 的 `## key（YYYY-MM-DD HH:MM）` 段落 → JSON entries（幂等）
 * - 提供查询 API：`queryMemoryEntries(selfDir, {query?, tags?, since?, limit?})`
 *
 * @ref docs/工程管理/迭代/all/20260422_feature_memory_curation.md — implements — Phase 1+3
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, unlinkSync } from "node:fs";
import { join as pathJoin } from "node:path";
import {
  rebuildEntryEmbedding,
  readEmbedding,
  deleteEmbedding,
  generateEmbedding,
  cosineSimilarity,
} from "./embedding.js";

/** 单条 memory entry（落盘 JSON 结构） */
export interface MemoryEntry {
  /** 稳定 id（首次生成后不变）：`me_{YYYYMMDD}_{hash8}` */
  id: string;
  /** 短标题（等价于 memory.md 的 `## key`） */
  key: string;
  /** 完整内容 */
  content: string;
  /** 标签（用于检索/分组），可为空数组 */
  tags: string[];
  /** 分类（自由字段，如 "workflow" / "debugging"），可为空 */
  category: string;
  /** 创建时间 ISO 8601 */
  createdAt: string;
  /** 最近一次 update 时间 ISO 8601（merge/去重时会变） */
  updatedAt: string;
  /** 是否固化（pinned）——不受 TTL 影响，合并时优先保留 */
  pinned: boolean;
  /** 生存期（天）。null = 永久。到期后 query 默认过滤，物理删除由 GC 任务做 */
  ttlDays: number | null;
  /** 来源信息 */
  source: {
    /** 沉淀工具（如 persist_to_memory / migrate_from_md） */
    type: string;
    /** 所属对象名（stone name） */
    stoneName: string;
    /** 可选：原始 memory.md 行号（迁移时填） */
    mdLine?: number;
  };
}

/** 查询参数 */
export interface QueryMemoryOptions {
  /** 模糊匹配（key / content / tags / category 都参与） */
  query?: string;
  /** 按 tag 过滤（任一命中） */
  tags?: string[];
  /** 最小时间（createdAt >= since） */
  since?: string;
  /** 返回上限（默认 50） */
  limit?: number;
  /** 是否包含过期 entry（默认 false） */
  includeExpired?: boolean;
  /** 只返回 pinned（默认 false） */
  onlyPinned?: boolean;
  /**
   * 检索模式（Phase 2 引入）：
   * - "fuzzy"（默认）：按 query 串做 key/content/tags/category 的 substring 模糊匹配，按 createdAt 降序
   * - "vector"：按 query 做 embedding top-K 余弦召回，按 score 降序（需要同时传 query）
   */
  mode?: "fuzzy" | "vector";
}

// ─── 内部工具 ────────────────────────────────────────────

function ensureDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

/**
 * 稳定 id 生成：基于 key + content 做简单 hash，再拼当日日期前缀
 *
 * 目的：同 key + 同 content 生成相同 id，迁移幂等
 */
export function generateEntryId(key: string, content: string, createdAt: string): string {
  const seed = `${key}|${content}`;
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = ((h << 5) - h + seed.charCodeAt(i)) | 0;
  const hex = (h >>> 0).toString(16).padStart(8, "0").slice(0, 8);
  const datePart = createdAt.slice(0, 10).replace(/-/g, "");
  return `me_${datePart}_${hex}`;
}

/**
 * 读取某 stone 的全部 memory entries（目录不存在返回空数组）
 */
export function readMemoryEntries(selfDir: string): MemoryEntry[] {
  const entriesDir = pathJoin(selfDir, "memory", "entries");
  if (!existsSync(entriesDir)) return [];
  const entries: MemoryEntry[] = [];
  for (const file of readdirSync(entriesDir)) {
    /* 跳过 embedding 旁路文件（Phase 2；`.embedding.json` 不是 entry） */
    if (file.endsWith(".embedding.json")) continue;
    if (!file.endsWith(".json")) continue;
    try {
      const raw = readFileSync(pathJoin(entriesDir, file), "utf-8");
      const parsed = JSON.parse(raw);
      if (isMemoryEntry(parsed)) entries.push(parsed);
    } catch {
      /* 单条坏文件不阻塞整体读 */
    }
  }
  return entries;
}

/**
 * 运行时类型守卫
 */
export function isMemoryEntry(v: any): v is MemoryEntry {
  return (
    v !== null &&
    typeof v === "object" &&
    typeof v.id === "string" &&
    typeof v.key === "string" &&
    typeof v.content === "string" &&
    Array.isArray(v.tags) &&
    typeof v.category === "string" &&
    typeof v.createdAt === "string" &&
    typeof v.updatedAt === "string" &&
    typeof v.pinned === "boolean" &&
    (v.ttlDays === null || typeof v.ttlDays === "number") &&
    v.source !== null &&
    typeof v.source === "object"
  );
}

/**
 * 写入单条 entry；若 id 已存在则更新 updatedAt（不覆盖 createdAt）
 */
export function writeMemoryEntry(selfDir: string, entry: MemoryEntry): void {
  const entriesDir = pathJoin(selfDir, "memory", "entries");
  ensureDir(entriesDir);
  const filePath = pathJoin(entriesDir, `${entry.id}.json`);
  writeFileSync(filePath, JSON.stringify(entry, null, 2), "utf-8");
}

/**
 * 新建 entry 并写盘（id 自动生成；已存在同 id 则合并：content/tags 去重并集）
 */
export function appendMemoryEntry(
  selfDir: string,
  stoneName: string,
  input: {
    key: string;
    content: string;
    tags?: string[];
    category?: string;
    pinned?: boolean;
    ttlDays?: number | null;
    sourceType?: string;
    createdAt?: string;
  },
): MemoryEntry {
  const createdAt = input.createdAt ?? new Date().toISOString();
  const id = generateEntryId(input.key, input.content, createdAt);
  const existing = readMemoryEntries(selfDir).find(e => e.id === id);

  const now = new Date().toISOString();
  const merged: MemoryEntry = existing
    ? {
        ...existing,
        /* content / key 不变（id 由它们推导）；tags 取并集；category pinned ttl 若传入则覆盖 */
        tags: Array.from(new Set([...(existing.tags ?? []), ...(input.tags ?? [])])),
        category: input.category ?? existing.category,
        pinned: input.pinned ?? existing.pinned,
        ttlDays: input.ttlDays === undefined ? existing.ttlDays : input.ttlDays,
        updatedAt: now,
      }
    : {
        id,
        key: input.key,
        content: input.content,
        tags: input.tags ?? [],
        category: input.category ?? "",
        createdAt,
        updatedAt: now,
        pinned: input.pinned ?? false,
        ttlDays: input.ttlDays === undefined ? null : input.ttlDays,
        source: { type: input.sourceType ?? "persist_to_memory", stoneName },
      };

  writeMemoryEntry(selfDir, merged);

  /* Phase 2：side-effect 生成 embedding（零网络、确定性）。
     失败不抛——embedding 丢了还可以通过 fuzzy 检索，后续 rebuild 机制会补。 */
  try {
    rebuildEntryEmbedding(selfDir, merged.id, merged.key, merged.content);
  } catch {
    /* ignore */
  }

  return merged;
}

/**
 * 查询 entries，支持关键词/tags/since/pinned 过滤
 *
 * 排序：
 * - `mode="fuzzy"`（默认）：按 createdAt 降序
 * - `mode="vector"`：按 query embedding 的余弦相似度降序（需 options.query 非空，
 *   否则自动回退到 fuzzy 排序）
 */
export function queryMemoryEntries(
  selfDir: string,
  options: QueryMemoryOptions = {},
): MemoryEntry[] {
  const all = readMemoryEntries(selfDir);
  const now = Date.now();
  const mode = options.mode ?? "fuzzy";

  let filtered = all.filter(e => {
    /* TTL 过滤 */
    if (!options.includeExpired && e.ttlDays !== null && !e.pinned) {
      const age = now - new Date(e.createdAt).getTime();
      if (age > e.ttlDays * 24 * 3600 * 1000) return false;
    }
    /* pinned only */
    if (options.onlyPinned && !e.pinned) return false;
    /* tags */
    if (options.tags && options.tags.length > 0) {
      if (!e.tags.some(t => options.tags!.includes(t))) return false;
    }
    /* since */
    if (options.since) {
      if (new Date(e.createdAt).getTime() < new Date(options.since).getTime()) return false;
    }
    /* vector mode 不再做 substring 预过滤——让所有未过期 entry 都参与余弦排序；
     * fuzzy mode 仍按 substring 预过滤 */
    if (mode === "fuzzy" && options.query) {
      const q = options.query.toLowerCase();
      const hay = [e.key, e.content, e.category, ...e.tags].join(" ").toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  if (mode === "vector" && options.query && options.query.trim().length > 0) {
    const qVec = generateEmbedding(options.query);
    /* 为每个 entry 取（或现场计算）embedding，算余弦 */
    const scored = filtered.map(e => {
      let v = readEmbedding(selfDir, e.id);
      if (!v) v = generateEmbedding(`${e.key} ${e.content}`);
      return { entry: e, score: cosineSimilarity(qVec, v) };
    });
    scored.sort((a, b) => b.score - a.score);
    /* 过滤掉 score <= 0 的（完全不相关）——避免无意义的降序尾巴 */
    filtered = scored.filter(s => s.score > 0).map(s => s.entry);
  } else {
    filtered.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  if (options.limit !== undefined && options.limit > 0) {
    filtered = filtered.slice(0, options.limit);
  }
  return filtered;
}

/**
 * 迁移：解析 memory.md 的 `## key（YYYY-MM-DD HH:MM）` 段落 → JSON entries
 *
 * 幂等：基于 generateEntryId（key + content hash）去重，多次跑结果一致。
 * 不删除原 memory.md（保留为 readonly snapshot）。
 *
 * @returns 迁移条目数（新建 + 已存在合并）
 */
export function migrateMemoryMdToEntries(
  selfDir: string,
  stoneName: string,
): { created: number; existing: number; total: number } {
  const mdPath = pathJoin(selfDir, "memory.md");
  if (!existsSync(mdPath)) return { created: 0, existing: 0, total: 0 };

  const raw = readFileSync(mdPath, "utf-8");
  const parsed = parseMemoryMd(raw);

  const existingIds = new Set(readMemoryEntries(selfDir).map(e => e.id));
  let created = 0;
  let existing = 0;
  for (const item of parsed) {
    const createdAt = parseDateStampOrNow(item.stamp);
    const id = generateEntryId(item.key, item.content, createdAt);
    if (existingIds.has(id)) {
      existing++;
      continue;
    }
    const entry: MemoryEntry = {
      id,
      key: item.key,
      content: item.content,
      tags: [],
      category: "",
      createdAt,
      updatedAt: new Date().toISOString(),
      pinned: false,
      ttlDays: null,
      source: {
        type: "migrate_from_md",
        stoneName,
        mdLine: item.startLine,
      },
    };
    writeMemoryEntry(selfDir, entry);
    try { rebuildEntryEmbedding(selfDir, entry.id, entry.key, entry.content); } catch { /* ignore */ }
    created++;
  }
  return { created, existing, total: parsed.length };
}

/** memory.md 段落内部结构 */
export interface ParsedMdSection {
  key: string;
  /** "YYYY-MM-DD HH:MM" 或空串（没带时间戳的段落） */
  stamp: string;
  content: string;
  /** 起始行号（1-based） */
  startLine: number;
}

/**
 * 解析 memory.md：按 `## xxx` 分段，第一行 `# title` 是顶级标题，跳过。
 * `## xxx（YYYY-MM-DD HH:MM）` 中的时间戳若存在则提取；否则 stamp 为空。
 * 段落 body = 标题下方直到下一个 `## ` 之间的内容（trim 后）。
 */
export function parseMemoryMd(raw: string): ParsedMdSection[] {
  const lines = raw.split("\n");
  const sections: ParsedMdSection[] = [];

  let cur: ParsedMdSection | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    /* 顶级 # 忽略；## 是段落分隔 */
    if (line.startsWith("## ")) {
      if (cur) {
        cur.content = cur.content.trim();
        if (cur.content.length > 0) sections.push(cur);
      }
      const heading = line.slice(3).trim();
      /* 尝试提取 `标题（YYYY-MM-DD HH:MM）` */
      const m = heading.match(/^(.*?)(?:（(\d{4}-\d{2}-\d{2}(?: \d{2}:\d{2})?)）|\((\d{4}-\d{2}-\d{2}(?: \d{2}:\d{2})?)\))?\s*$/);
      const key = (m?.[1] ?? heading).trim();
      const stamp = (m?.[2] ?? m?.[3] ?? "").trim();
      cur = {
        key,
        stamp,
        content: "",
        startLine: i + 1,
      };
      continue;
    }
    if (cur) {
      cur.content += (cur.content.length > 0 ? "\n" : "") + line;
    }
  }
  if (cur) {
    cur.content = cur.content.trim();
    if (cur.content.length > 0) sections.push(cur);
  }
  return sections;
}

/**
 * 把 memory.md 时间戳字符串（"2026-04-22 10:30" 或 "2026-04-22"）转 ISO 8601
 * 空 / 非法 → 当前时间
 */
export function parseDateStampOrNow(stamp: string): string {
  if (!stamp) return new Date().toISOString();
  /* YYYY-MM-DD HH:MM 或 YYYY-MM-DD */
  const m = stamp.match(/^(\d{4})-(\d{2})-(\d{2})(?:\s+(\d{2}):(\d{2}))?$/);
  if (!m) return new Date().toISOString();
  const [, year, month, day, hour, minute] = m;
  if (!year || !month || !day) return new Date().toISOString();
  const y = parseInt(year, 10);
  const mo = parseInt(month, 10) - 1;
  const d = parseInt(day, 10);
  const hh = hour ? parseInt(hour, 10) : 0;
  const mm = minute ? parseInt(minute, 10) : 0;
  const date = new Date(Date.UTC(y, mo, d, hh, mm));
  return date.toISOString();
}

/**
 * 生成 `{selfDir}/memory/index.md` —— 结构化 entries 的只读索引
 *
 * 格式：
 *   # Memory Index — {stoneName}
 *   _自动生成；请通过 talk(super, ...) 沉淀新条目_
 *
 *   ## Pinned
 *   - [key](entries/{id}.json) — {createdAt} — {tags join ','}
 *
 *   ## Recent (by createdAt desc, top 20)
 *   ...
 */
export function rebuildMemoryIndex(selfDir: string, stoneName: string): string {
  const entries = readMemoryEntries(selfDir);
  const lines: string[] = [];
  lines.push(`# Memory Index — ${stoneName}`);
  lines.push("");
  lines.push("_自动生成；请通过 `talk(\"super\", ...)` 沉淀新条目。本文件只读——修改会被下次 rebuild 覆盖。_");
  lines.push("");

  const pinned = entries.filter(e => e.pinned);
  if (pinned.length > 0) {
    lines.push("## Pinned");
    lines.push("");
    for (const e of pinned) {
      lines.push(renderIndexLine(e));
    }
    lines.push("");
  }

  const recent = entries
    .filter(e => !e.pinned)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 20);
  if (recent.length > 0) {
    lines.push("## Recent");
    lines.push("");
    for (const e of recent) {
      lines.push(renderIndexLine(e));
    }
    lines.push("");
  }

  lines.push(`_共 ${entries.length} 条（${pinned.length} pinned / ${entries.length - pinned.length} 非 pinned）_`);
  const indexPath = pathJoin(selfDir, "memory", "index.md");
  ensureDir(pathJoin(selfDir, "memory"));
  const body = lines.join("\n") + "\n";
  writeFileSync(indexPath, body, "utf-8");
  return body;
}

function renderIndexLine(e: MemoryEntry): string {
  const when = e.createdAt.slice(0, 10);
  const tags = e.tags.length > 0 ? ` — ${e.tags.map(t => `#${t}`).join(" ")}` : "";
  const cat = e.category ? ` \`${e.category}\`` : "";
  return `- [${e.key}](entries/${e.id}.json) — ${when}${cat}${tags}`;
}

/**
 * 合并重复条目（相同 key 且 content 高度相似）
 *
 * 简单策略（不用 embedding，纯字符串）：
 * - 同 key 的 entries 合并为一条；保留最早 createdAt、最新 updatedAt
 * - content 取所有原内容拼接去重行
 * - tags 并集，pinned 任一为 true 则 true
 *
 * 返回合并统计
 */
export function mergeDuplicateEntries(
  selfDir: string,
): { merged: number; kept: number } {
  const all = readMemoryEntries(selfDir);
  const byKey = new Map<string, MemoryEntry[]>();
  for (const e of all) {
    const arr = byKey.get(e.key) ?? [];
    arr.push(e);
    byKey.set(e.key, arr);
  }

  let mergedCount = 0;
  for (const [, group] of byKey) {
    if (group.length <= 1) continue;
    /* 按 createdAt 升序：第一个最早 */
    group.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    const first = group[0];
    if (!first) continue;
    const rest = group.slice(1);

    const contentLines = new Set(first.content.split("\n"));
    for (const r of rest) {
      for (const l of r.content.split("\n")) contentLines.add(l);
    }
    const merged: MemoryEntry = {
      ...first,
      content: Array.from(contentLines).join("\n").trim(),
      tags: Array.from(new Set([first.tags, ...rest.map(r => r.tags)].flat())),
      pinned: first.pinned || rest.some(r => r.pinned),
      updatedAt: new Date().toISOString(),
    };
    writeMemoryEntry(selfDir, merged);
    /* 合并后的 entry 内容发生变化，embedding 需重建 */
    try { rebuildEntryEmbedding(selfDir, merged.id, merged.key, merged.content); } catch { /* ignore */ }
    /* 删除被合并的 rest（物理删除 JSON 文件 + 其 embedding） */
    const entriesDir = pathJoin(selfDir, "memory", "entries");
    for (const r of rest) {
      try {
        unlinkSync(pathJoin(entriesDir, `${r.id}.json`));
        deleteEmbedding(selfDir, r.id);
        mergedCount++;
      } catch {
        /* 文件不存在等，忽略 */
      }
    }
  }

  const kept = readMemoryEntries(selfDir).length;
  return { merged: mergedCount, kept };
}
