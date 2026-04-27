/**
 * reflective/memory_api —— 长期记忆 API（kernel trait）
 *
 * 提供 **只读查询** 方法 `query_memory`，让主线程能按 query/tags/since/pinned 检索结构化记忆。
 *
 * 写入通道仍然只有一个：`talk("super", ...)` → super 分身调 `persist_to_memory`。
 * 本 trait 只读，不暴露 write。
 *
 * 只有显式激活 memory_api 的对象能调用，防止越权。
 *
 * @ref docs/工程管理/迭代/all/20260422_feature_memory_curation.md — implements — Phase 3
 */

import type { TraitMethod } from "../../../src/types/index";
import { toolOk, toolErr } from "../../../src/types/tool-result";
import {
  queryMemoryEntries,
  readMemoryEntries,
} from "../../../src/persistence/memory-entries";
import type { MemoryEntry, QueryMemoryOptions } from "../../../src/persistence/memory-entries";

/** query_memory 输入 */
export interface QueryMemoryInput extends QueryMemoryOptions {}

/** query_memory 返回的精简视图（省略大 content；LLM 可按 id 再获取详情） */
export interface MemoryEntrySummary {
  id: string;
  key: string;
  /** content 截断到 200 字符 */
  contentPreview: string;
  tags: string[];
  category: string;
  createdAt: string;
  pinned: boolean;
}

const CONTENT_PREVIEW_LEN = 200;

function toSummary(e: MemoryEntry): MemoryEntrySummary {
  const pv =
    e.content.length > CONTENT_PREVIEW_LEN
      ? `${e.content.slice(0, CONTENT_PREVIEW_LEN)}…`
      : e.content;
  return {
    id: e.id,
    key: e.key,
    contentPreview: pv,
    tags: e.tags,
    category: e.category,
    createdAt: e.createdAt,
    pinned: e.pinned,
  };
}

export const llm_methods: Record<string, TraitMethod> = {
  query_memory: {
    name: "query_memory",
    description:
      "查询长期记忆条目（结构化 memory/entries/*.json）。按 query（模糊匹配 key/content/tags/category）+ tags + since + pinned + limit 过滤，返回精简摘要列表（含 contentPreview 200 字符截断）。不返回过期条目（除非 includeExpired=true）。mode=\"vector\" 时按 query embedding 余弦相似度召回 top-K（自动跳过不相关条目；query 为空时自动回退到时间倒序）。",
    params: [
      { name: "query", type: "string", description: "检索关键词（fuzzy 模式做 substring，vector 模式做语义相关性）", required: false },
      { name: "mode", type: "string", description: "\"fuzzy\"（默认，substring）或 \"vector\"（hash n-gram 余弦 top-K）", required: false },
      { name: "tags", type: "string[]", description: "按 tag 过滤（任一命中）", required: false },
      { name: "since", type: "string", description: "ISO 8601 最早时间", required: false },
      { name: "limit", type: "number", description: "返回上限（默认 50）", required: false },
      { name: "onlyPinned", type: "boolean", description: "只返回 pinned", required: false },
      { name: "includeExpired", type: "boolean", description: "包含过期条目", required: false },
    ],
    fn: (async (
      ctx: { selfDir: string; stoneName: string },
      input: QueryMemoryInput,
    ) => {
      try {
        const entries = queryMemoryEntries(ctx.selfDir, input ?? {});
        return toolOk({
          stoneName: ctx.stoneName,
          total: entries.length,
          entries: entries.map(toSummary),
        });
      } catch (err: any) {
        return toolErr(`query_memory 失败: ${err?.message ?? String(err)}`);
      }
    }) as TraitMethod["fn"],
  },

  get_memory_entry: {
    name: "get_memory_entry",
    description:
      "按 id 获取单条 memory entry 的完整内容（含全文、tags、ttl 等元信息）。",
    params: [
      { name: "id", type: "string", description: "memory entry id", required: true },
    ],
    fn: (async (
      ctx: { selfDir: string; stoneName: string },
      { id }: { id: string },
    ) => {
      if (!id?.trim()) return toolErr("get_memory_entry: id 必填");
      try {
        const entry = readMemoryEntries(ctx.selfDir).find(e => e.id === id);
        if (!entry) return toolErr(`get_memory_entry: 找不到 id=${id}`);
        return toolOk(entry);
      } catch (err: any) {
        return toolErr(`get_memory_entry 失败: ${err?.message ?? String(err)}`);
      }
    }) as TraitMethod["fn"],
  },
};

export const ui_methods: Record<string, TraitMethod> = {};
