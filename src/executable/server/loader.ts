import { stat } from "node:fs/promises";
import { serverIndexFile } from "../../persistable";
import type { LlmMethods, ServerLoaderEntry, StoneObjectRef } from "./types";

const cache = new Map<string, ServerLoaderEntry>();

async function loadServerEntry(stoneRef: StoneObjectRef): Promise<ServerLoaderEntry | undefined> {
  const file = serverIndexFile(stoneRef);
  let stats;
  try {
    stats = await stat(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }

  const mtime = stats.mtimeMs;
  const cached = cache.get(file);
  if (cached && cached.mtime === mtime) return cached;

  // 用 mtime 作为 query string 破坏 import cache，让 Agent 刚写的版本生效。
  const mod = await import(`${file}?t=${mtime}`);
  const entry: ServerLoaderEntry = {
    mtime,
    llmMethods: (mod.llm_methods ?? {}) as LlmMethods,
    uiMethods: (mod.ui_methods ?? {}) as LlmMethods,
  };
  cache.set(file, entry);
  return entry;
}

/**
 * 动态加载 stone 的 server/index.ts 中 llm_methods，按 mtime 缓存。
 * - 文件不存在 → {}
 * - 解析失败 → 抛带原始错误信息的异常（由调用方决定怎么呈现）
 */
export async function loadLlmServerMethods(stoneRef: StoneObjectRef): Promise<LlmMethods> {
  return (await loadServerEntry(stoneRef))?.llmMethods ?? {};
}

/** 动态加载 stone 的 server/index.ts 中 ui_methods。 */
export async function loadUiServerMethods(stoneRef: StoneObjectRef): Promise<LlmMethods> {
  return (await loadServerEntry(stoneRef))?.uiMethods ?? {};
}

export const loadServerMethods = loadLlmServerMethods;

/** 测试钩子：清空 loader 缓存。 */
export function clearServerLoaderCache(): void {
  cache.clear();
}
