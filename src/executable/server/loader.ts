import { stat } from "node:fs/promises";
import { executableIndexFile } from "../../persistable";
import type { ServerLoaderEntry, StoneObjectRef, UiMethods } from "./types";
import type { ObjectWindowDefinition } from "./window-types";

const cache = new Map<string, ServerLoaderEntry>();

async function loadServerEntry(stoneRef: StoneObjectRef): Promise<ServerLoaderEntry | undefined> {
  const file = executableIndexFile(stoneRef);
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

  // D6 硬切：旧 llm_methods 已不再支持；发现就抛清晰错误，避免静默吃掉
  if ("llm_methods" in mod) {
    throw new Error(
      `${file}: 'llm_methods' 已被移除（plan D6）；请改写为 \`export const window: ObjectWindowDefinition = { commands: { ... } }\``,
    );
  }

  const entry: ServerLoaderEntry = {
    mtime,
    window: (mod.window ?? undefined) as ObjectWindowDefinition | undefined,
    uiMethods: (mod.ui_methods ?? {}) as UiMethods,
  };
  cache.set(file, entry);
  return entry;
}

/**
 * 动态加载 stone 的 `export const window`，按 mtime 缓存。
 * - 文件不存在 → undefined
 * - 没有 `export const window` → undefined
 * - 有 llm_methods（已弃用） → 抛错
 * - 解析失败 → 抛带原始错误信息的异常
 */
export async function loadObjectWindow(
  stoneRef: StoneObjectRef,
): Promise<ObjectWindowDefinition | undefined> {
  return (await loadServerEntry(stoneRef))?.window;
}

/** 动态加载 stone 的 server/index.ts 中 ui_methods（D3 路径完全保留）。 */
export async function loadUiServerMethods(stoneRef: StoneObjectRef): Promise<UiMethods> {
  return (await loadServerEntry(stoneRef))?.uiMethods ?? {};
}

/** 测试钩子：清空 loader 缓存。 */
export function clearServerLoaderCache(): void {
  cache.clear();
}
