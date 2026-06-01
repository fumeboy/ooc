import { stat } from "node:fs/promises";
import { serverIndexFile, executableIndexFile, readableTsFile } from "../../persistable";
import type { ServerLoaderEntry, StoneObjectRef, UiMethods } from "./types";
import type { ObjectWindowDefinition } from "./window-types";
import type { ReadableFn } from "../windows/_shared/registry.js";
import type { ObjectMethod } from "../windows/_shared/command-types.js";

const cache = new Map<string, ServerLoaderEntry>();

/**
 * Resolve the actual server/executable index file path.
 * Dual-read pattern: try new executable/ path first, fallback to old server/ path.
 */
async function resolveExecutableFile(ref: StoneObjectRef): Promise<{ path: string; mtime: number } | undefined> {
  const newPath = executableIndexFile(ref);
  try {
    const stats = await stat(newPath);
    return { path: newPath, mtime: stats.mtimeMs };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const oldPath = serverIndexFile(ref);
  try {
    const stats = await stat(oldPath);
    return { path: oldPath, mtime: stats.mtimeMs };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function loadServerEntry(stoneRef: StoneObjectRef): Promise<ServerLoaderEntry | undefined> {
  const readableFile = readableTsFile(stoneRef);

  // Resolve executable file path (dual-read: executable/ first, then server/)
  const executableInfo = await resolveExecutableFile(stoneRef);

  if (!executableInfo) {
    // No executable file - check if readable.ts exists alone
    try {
      const readableStats = await stat(readableFile);
      const readableMod = await import(`${readableFile}?t=${readableStats.mtimeMs}`);
      let readable: ReadableFn | undefined;
      if (typeof readableMod.default === "function") {
        readable = readableMod.default as ReadableFn;
      } else if (typeof readableMod.readable === "function") {
        readable = readableMod.readable as ReadableFn;
      }
      const entry: ServerLoaderEntry = {
        mtime: readableStats.mtimeMs,
        window: undefined,
        uiMethods: {},
        readable,
      };
      cache.set(readableFile, entry);
      return entry;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw e;
    }
  }

  const { path: serverFile, mtime: serverMtime } = executableInfo;
  const cached = cache.get(serverFile);
  if (cached && cached.mtime === serverMtime) return cached;

  const mod = await import(`${serverFile}?t=${serverMtime}`);

  // D6 硬切：旧 llm_methods 已不再支持；发现就抛清晰错误，避免静默吃掉
  if ("llm_methods" in mod) {
    throw new Error(
      `${serverFile}: 'llm_methods' 已被移除（plan D6）；请改写为 \`export const window: ObjectWindowDefinition = { commands: { ... } }\``,
    );
  }

  // Load readable.ts if it exists (2026-05-28 ooc-6)
  let readable: ReadableFn | undefined;
  try {
    const readableStats = await stat(readableFile);
    const readableMod = await import(`${readableFile}?t=${readableStats.mtimeMs}`);
    if (typeof readableMod.default === "function") {
      readable = readableMod.default as ReadableFn;
    } else if (typeof readableMod.readable === "function") {
      readable = readableMod.readable as ReadableFn;
    }
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }

  const entry: ServerLoaderEntry = {
    mtime: serverMtime,
    window: (mod.window ?? undefined) as ObjectWindowDefinition | undefined,
    uiMethods: (mod.ui_methods ?? {}) as UiMethods,
    readable,
  };

  // Merge methods alias into commands (2026-05-28 ooc-6 transition support)
  if (entry.window) {
    const winDef = entry.window as ObjectWindowDefinition & { methods?: Record<string, ObjectMethod> };
    if (winDef.methods && !winDef.commands) {
      winDef.commands = winDef.methods;
    } else if (winDef.methods && winDef.commands) {
      winDef.commands = { ...winDef.methods, ...winDef.commands };
    }
  }

  cache.set(serverFile, entry);
  return entry;
}

/** 动态加载 stone 的 `export const window`，按 mtime 缓存。
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

/**
 * 动态加载 stone 的 readable.ts 导出的渲染函数（2026-05-28 ooc-6 新增）。
 * 支持 `export default` 或 `export const readable`。
 * - 文件不存在 → undefined
 * - 没有导出函数 → undefined
 */
export async function loadObjectReadable(stoneRef: StoneObjectRef): Promise<ReadableFn | undefined> {
  return (await loadServerEntry(stoneRef))?.readable;
}

/** 测试钩子：清空 loader 缓存。 */
export function clearServerLoaderCache(): void {
  cache.clear();
}
