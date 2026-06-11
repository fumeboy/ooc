/**
 * ServerLoader — 动态加载 stone 的 executable / readable 模块。
 *
 * 从 executable/server/loader.ts 抽出为可实例化类。
 * 原有 module-level 导出保留作为对 `defaultServerLoader` 的 thin wrapper。
 */
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { resolveStoneDir } from "../persistable/index.js";
import type { StoneObjectRef } from "../persistable/index.js";
import type { ReadableFn, ObjectDefinition } from "../executable/windows/_shared/registry.js";

/**
 * loader 缓存条目（loader 私有；按 mtime 失效）。
 *
 * `window` 即 stone 的 `export const window`（Partial<ObjectDefinition>），其 `readable`
 * 已合并独立 `readable.ts` 的导出——两者同属 ObjectDefinition.readable，不再拆成两个字段。
 * HTTP call_method 走 `window.methods` 里 `for_ui_access` 的方法（废 ui_methods 维度）。
 */
interface LoaderCacheEntry {
  mtime: number;
  window: Partial<ObjectDefinition> | undefined;
}

export class ServerLoader {
  private readonly cache = new Map<string, LoaderCacheEntry>();

  /** 加载 stone 的独立 `readable.ts`（default 或具名 `readable` 导出）；缺失返回 undefined。 */
  private async loadReadableTs(
    readableFile: string,
  ): Promise<{ fn: ReadableFn; mtime: number } | undefined> {
    try {
      const stats = await stat(readableFile);
      const mod = await import(`${readableFile}?t=${stats.mtimeMs}`);
      const fn =
        typeof mod.default === "function"
          ? mod.default
          : typeof mod.readable === "function"
            ? mod.readable
            : undefined;
      return fn ? { fn: fn as ReadableFn, mtime: stats.mtimeMs } : undefined;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw e;
    }
  }

  private async resolveExecutableFile(
    ref: StoneObjectRef,
  ): Promise<{ path: string; mtime: number } | undefined> {
    const resolvedStoneDir = await resolveStoneDir(ref);
    const newPath = join(resolvedStoneDir, "executable", "index.ts");
    try {
      const stats = await stat(newPath);
      return { path: newPath, mtime: stats.mtimeMs };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const oldPath = join(resolvedStoneDir, "server", "index.ts");
    try {
      const stats = await stat(oldPath);
      return { path: oldPath, mtime: stats.mtimeMs };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  }

  private async loadEntry(stoneRef: StoneObjectRef): Promise<LoaderCacheEntry | undefined> {
    const resolvedStoneDir = await resolveStoneDir(stoneRef);
    const readableFile = join(resolvedStoneDir, "readable.ts");
    const executableInfo = await this.resolveExecutableFile(stoneRef);

    // 无 executable/index.ts：仅有独立 readable.ts → window 只携带 readable。
    if (!executableInfo) {
      const r = await this.loadReadableTs(readableFile);
      if (!r) return undefined;
      const entry: LoaderCacheEntry = { mtime: r.mtime, window: { readable: r.fn } };
      this.cache.set(readableFile, entry);
      return entry;
    }

    const { path: serverFile, mtime: serverMtime } = executableInfo;
    const cached = this.cache.get(serverFile);
    if (cached && cached.mtime === serverMtime) return cached;

    const mod = await import(`${serverFile}?t=${serverMtime}`);

    if ("llm_methods" in mod) {
      throw new Error(
        `${serverFile}: 'llm_methods' 已被移除；请改写为 \`export const window: Partial<ObjectDefinition> = { methods: { ... } }\``,
      );
    }

    const win = (mod.window ?? undefined) as Partial<ObjectDefinition> | undefined;
    const readableTs = await this.loadReadableTs(readableFile);
    // 合并 readable.ts 进 window.readable（window 自带 readable 优先），二者同属 ObjectDefinition.readable。
    const window: Partial<ObjectDefinition> | undefined =
      win || readableTs
        ? { ...(win ?? {}), readable: win?.readable ?? readableTs?.fn }
        : undefined;

    const entry: LoaderCacheEntry = { mtime: serverMtime, window };
    this.cache.set(serverFile, entry);
    return entry;
  }

  /** 动态加载 stone 的 `export const window`（readable 已合并 readable.ts），按 mtime 缓存。 */
  async loadObjectWindow(stoneRef: StoneObjectRef): Promise<Partial<ObjectDefinition> | undefined> {
    return (await this.loadEntry(stoneRef))?.window;
  }

  /** 使单个 stone 的缓存条目失效（热更新用）。 */
  async invalidateStone(stoneRef: StoneObjectRef): Promise<void> {
    const resolvedDir = await resolveStoneDir(stoneRef);
    // Remove all cache entries whose key falls under this stone's resolved directory.
    for (const key of Array.from(this.cache.keys())) {
      if (key.startsWith(resolvedDir)) this.cache.delete(key);
    }
  }

  /** 清空整个 loader 缓存（测试用）。 */
  clearCache(): void {
    this.cache.clear();
  }
}

/** module-level 默认实例——所有 module-level wrapper 函数委托给它。 */
export const defaultServerLoader = new ServerLoader();

/** 创建一个全新的独立 loader 实例（给 WorldRuntime 用）。 */
export function createServerLoader(): ServerLoader {
  return new ServerLoader();
}

/** 动态加载 stone 的 `export const window`，按 mtime 缓存（委托默认实例）。 */
export async function loadObjectWindow(
  stoneRef: StoneObjectRef,
): Promise<Partial<ObjectDefinition> | undefined> {
  return defaultServerLoader.loadObjectWindow(stoneRef);
}

/** 测试钩子：清空默认实例的 loader 缓存。 */
export function clearServerLoaderCache(): void {
  defaultServerLoader.clearCache();
}
