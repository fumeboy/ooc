/**
 * ServerLoader — 动态加载 stone 的 executable / readable 模块。
 *
 * M1 (2026-06-02): 从 executable/server/loader.ts 抽出为可实例化类。
 * 原有 module-level 导出保留作为对 `defaultServerLoader` 的 thin wrapper。
 */
import { stat } from "node:fs/promises";
import { join } from "node:path";
import {
  resolveStoneDir,
} from "../persistable/index.js";
import type { ReadableFn } from "../executable/windows/_shared/registry.js";
import type { ObjectMethod } from "../executable/windows/_shared/command-types.js";
import type {
  ServerLoaderEntry,
  StoneObjectRef,
  UiMethods,
} from "../executable/object/types.js";
import type { StoneObjectDeclaration } from "../executable/object/object-types.js";

export class ServerLoader {
  private readonly cache = new Map<string, ServerLoaderEntry>();

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

  private async loadEntry(stoneRef: StoneObjectRef): Promise<ServerLoaderEntry | undefined> {
    const resolvedStoneDir = await resolveStoneDir(stoneRef);
    const readableFile = join(resolvedStoneDir, "readable.ts");
    const executableInfo = await this.resolveExecutableFile(stoneRef);

    if (!executableInfo) {
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
        this.cache.set(readableFile, entry);
        return entry;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ENOENT") return undefined;
        throw e;
      }
    }

    const { path: serverFile, mtime: serverMtime } = executableInfo;
    const cached = this.cache.get(serverFile);
    if (cached && cached.mtime === serverMtime) return cached;

    const mod = await import(`${serverFile}?t=${serverMtime}`);

    if ("llm_methods" in mod) {
      throw new Error(
        `${serverFile}: 'llm_methods' 已被移除；请改写为 \`export const window: StoneObjectDeclaration = { commands: { ... } }\``,
      );
    }

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
      window: (mod.window ?? undefined) as StoneObjectDeclaration | undefined,
      uiMethods: (mod.ui_methods ?? {}) as UiMethods,
      readable,
    };

    if (entry.window) {
      const winDef = entry.window;
      const hasMethods = winDef.methods && Object.keys(winDef.methods).length > 0;
      const hasCommands = winDef.commands && Object.keys(winDef.commands).length > 0;
      if (hasMethods && !hasCommands) {
        winDef.commands = winDef.methods;
      } else if (hasMethods && hasCommands) {
        winDef.commands = { ...winDef.methods, ...winDef.commands };
      } else if (!hasMethods && hasCommands) {
        winDef.methods = winDef.commands;
      }
    }

    this.cache.set(serverFile, entry);
    return entry;
  }

  /** 动态加载 stone 的 `export const window`，按 mtime 缓存。 */
  async loadObjectWindow(stoneRef: StoneObjectRef): Promise<StoneObjectDeclaration | undefined> {
    return (await this.loadEntry(stoneRef))?.window;
  }

  /** 动态加载 stone 的 ui_methods。 */
  async loadUiServerMethods(stoneRef: StoneObjectRef): Promise<UiMethods> {
    return (await this.loadEntry(stoneRef))?.uiMethods ?? {};
  }

  /** 动态加载 stone 的 readable.ts 导出的渲染函数。 */
  async loadObjectReadable(stoneRef: StoneObjectRef): Promise<ReadableFn | undefined> {
    return (await this.loadEntry(stoneRef))?.readable;
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
): Promise<StoneObjectDeclaration | undefined> {
  return defaultServerLoader.loadObjectWindow(stoneRef);
}

/** 动态加载 stone 的 server/index.ts 中 ui_methods（委托默认实例）。 */
export async function loadUiServerMethods(stoneRef: StoneObjectRef): Promise<UiMethods> {
  return defaultServerLoader.loadUiServerMethods(stoneRef);
}

/** 动态加载 stone 的 readable.ts 导出的渲染函数（委托默认实例）。 */
export async function loadObjectReadable(stoneRef: StoneObjectRef): Promise<ReadableFn | undefined> {
  return defaultServerLoader.loadObjectReadable(stoneRef);
}

/** 测试钩子：清空默认实例的 loader 缓存。 */
export function clearServerLoaderCache(): void {
  defaultServerLoader.clearCache();
}
