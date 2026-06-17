/**
 * ServerLoader —— 动态加载 stone（world 对象）的 `export const Class`（OocClass）+ 继承元信息。
 *
 * Wave 4 对象模型：world 对象与 builtin 包同形——stone 目录有一个 `index.ts` 一处
 * `export const Class: OocClass<Data>`（装配 construct / executable / readable / persistable），
 * 及 `package.json` 的 `ooc.{objectId, class}`（继承父类）。loader 不再读旧
 * `executable/index.ts` 的 `export const window`（barrel）。
 *
 * loader 只负责「从磁盘 import Class + 读 ooc.class」并按 mtime 缓存；把它注册进某个
 * {@link ObjectRegistry} 由 {@link loadAndRegisterStoneClass} 收口（继承链 ensure 等渲染期策略
 * 留给调用方）。
 */
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { resolveStoneDir, readStoneClass } from "../persistable/index.js";
import type { StoneObjectRef } from "../persistable/index.js";
import type { OocClass } from "./ooc-class.js";
import type { ObjectRegistry } from "./object-registry.js";

/** loader 加载出的 stone class —— Class 模块 + 继承父类（来自 package.json `ooc.class`）。 */
export interface LoadedStoneClass {
  cls: OocClass;
  parentClass: string | null | undefined;
}

/** loader 缓存条目（loader 私有；按 index.ts mtime 失效）。 */
interface LoaderCacheEntry {
  mtime: number;
  loaded: LoadedStoneClass | undefined;
}

export class ServerLoader {
  private readonly cache = new Map<string, LoaderCacheEntry>();

  /** 解析 stone 目录的 `index.ts`（`export const Class` 装配入口）；缺失返回 undefined。 */
  private async resolveClassFile(
    ref: StoneObjectRef,
  ): Promise<{ path: string; mtime: number } | undefined> {
    const resolvedStoneDir = await resolveStoneDir(ref);
    const indexPath = join(resolvedStoneDir, "index.ts");
    try {
      const stats = await stat(indexPath);
      return { path: indexPath, mtime: stats.mtimeMs };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  }

  private async loadEntry(stoneRef: StoneObjectRef): Promise<LoaderCacheEntry | undefined> {
    const classInfo = await this.resolveClassFile(stoneRef);
    // 无 index.ts：合法的纯 self.md / readable.md 对象（无后端程序路由）。
    if (!classInfo) return undefined;

    const { path: classFile, mtime } = classInfo;
    const cached = this.cache.get(classFile);
    if (cached && cached.mtime === mtime) return cached;

    const mod = await import(`${classFile}?t=${mtime}`);
    const cls = (mod.Class ?? undefined) as OocClass | undefined;
    if (!cls) {
      throw new Error(
        `${classFile}: 缺少 \`export const Class\`（OocClass 装配入口）。世界对象的 index.ts 必须一处导出 Class。`,
      );
    }
    const parentClass = await readStoneClass(stoneRef);

    const entry: LoaderCacheEntry = { mtime, loaded: { cls, parentClass } };
    this.cache.set(classFile, entry);
    return entry;
  }

  /** 动态加载 stone 的 `export const Class` + 继承父类（按 mtime 缓存）；无后端路由返回 undefined。 */
  async loadStoneClass(stoneRef: StoneObjectRef): Promise<LoadedStoneClass | undefined> {
    return (await this.loadEntry(stoneRef))?.loaded;
  }

  /**
   * 加载 stone 的 Class 并注册进给定 registry（键名=原始 objectId，registry 内部归一）。
   * 成功返回 true；该 stone 无 index.ts（纯 self.md 对象）返回 false。load 抛错向上抛（fail-loud）。
   */
  async loadAndRegisterStoneClass(
    stoneRef: StoneObjectRef,
    objectId: string,
    registry: ObjectRegistry,
  ): Promise<boolean> {
    const loaded = await this.loadStoneClass(stoneRef);
    if (loaded) {
      registry.register(objectId, loaded.cls, { parentClass: loaded.parentClass });
      return true;
    }
    // 无 index.ts（纯 self.md / readable.md 对象，如 supervisor）：仍读 package.json 的 ooc.class
    // 注册其 parentClass（空 Class）——让它经**单跳继承**拿到该 class 的 object method + seed knowledge
    // （否则 supervisor 等 agent 实例 getClass().parentClass 为空，既丢 agency 又丢 class 知识）。
    const parentClass = await readStoneClass(stoneRef);
    if (parentClass != null) {
      registry.register(objectId, {}, { parentClass });
      return true;
    }
    return false;
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

/** 动态加载 stone 的 `export const Class` + 继承父类，按 mtime 缓存（委托默认实例）。 */
export async function loadStoneClass(
  stoneRef: StoneObjectRef,
): Promise<LoadedStoneClass | undefined> {
  return defaultServerLoader.loadStoneClass(stoneRef);
}

/** 测试钩子：清空默认实例的 loader 缓存。 */
export function clearServerLoaderCache(): void {
  defaultServerLoader.clearCache();
}
