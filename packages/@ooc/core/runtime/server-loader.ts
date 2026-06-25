/**
 * ServerLoader —— 动态加载 stone（world 对象）的 `export const Class`（OocClass）+ 继承元信息。
 *
 * Wave 4 对象模型：world 对象与 builtin 包同形——class-defining stone 目录有一个 `index.ts` 一处
 * `export const Class: OocClass<Data>`（装配 construct / executable / readable / persistable），
 * 及 `package.json` 的 `ooc.{objectId, class}`。loader 只负责 import、缓存、与缓存失效。
 *
 * **OOC 协议层不内建任何继承机制**（object 模型核心 2 / 4）。**无 `index.ts` 的纯实例 object 不向
 * ClassRegistry 注册新 class**——hydrate 时 `OocObjectInstance.class = ooc.class`（=父 class id），
 * resolveXxx 直接命中父 class 的字段；class 间的能力复用全部由 class 源码用 import + spread 自行表达。
 *
 * 把加载结果注册进某个 {@link ClassRegistry} 由 {@link loadAndRegisterStoneClass} 收口；纯实例
 * stone（无 index.ts）走 hydrate 路径（runtime-object-io.ts），不经本 loader 的 register 端点。
 */
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { resolveStoneDir, readStoneClass } from "../persistable/index.js";
import type { StoneObjectRef } from "../persistable/index.js";
import type { OocClass } from "./ooc-class.js";
import type { ClassRegistry } from "./object-registry.js";

/** loader 加载出的 stone class —— Class 模块 + `ooc.class` 元信息（仅元信息，runtime 不沿其 fallback）。 */
export interface LoadedStoneClass {
  cls: OocClass;
  /** `package.json` 的 `ooc.class` 字段原值（runtime 不在 ClassRegistry 解析此字段，仅 caller 自定义用途）。 */
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
    // 无 index.ts：合法的纯实例 object（无后端程序路由）——不进 ClassRegistry，hydrate 时 inst.class = ooc.class 直指父。
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

  /** 动态加载 stone 的 `export const Class` + ooc.class 元信息（按 mtime 缓存）；无 index.ts 返回 undefined。 */
  async loadStoneClass(stoneRef: StoneObjectRef): Promise<LoadedStoneClass | undefined> {
    return (await this.loadEntry(stoneRef))?.loaded;
  }

  /**
   * 加载 class-defining stone 的 Class 并注册进给定 registry（键名 = `objectId`）。
   *
   * - 有 `index.ts` → `import { Class } → registry.register({ ...Class, id: objectId })`，返回 true。
   * - 无 `index.ts`（纯实例 object）→ **不**向 registry 注册新 class，返回 false；该 stone 后续靠
   *   hydrate 时把 `inst.class = ooc.class` 直接挂到父 class 的字段上（见 runtime-object-io.ts）。
   */
  async loadAndRegisterStoneClass(
    stoneRef: StoneObjectRef,
    objectId: string,
    registry: ClassRegistry,
  ): Promise<boolean> {
    const loaded = await this.loadStoneClass(stoneRef);
    if (!loaded) return false;
    registry.register({ ...loaded.cls, id: objectId });
    return true;
  }

  /** 使单个 stone 的缓存条目失效（热更新 + PR merge finalizer 用）。 */
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

/** 动态加载 stone 的 `export const Class` + ooc.class 元信息（委托默认实例）。 */
export async function loadStoneClass(
  stoneRef: StoneObjectRef,
): Promise<LoadedStoneClass | undefined> {
  return defaultServerLoader.loadStoneClass(stoneRef);
}

/** 使单个 stone 的默认 loader 缓存失效（PR merge finalizer 用）。 */
export async function invalidateStone(stoneRef: StoneObjectRef): Promise<void> {
  return defaultServerLoader.invalidateStone(stoneRef);
}

/** 测试钩子：清空默认实例的 loader 缓存。 */
export function clearServerLoaderCache(): void {
  defaultServerLoader.clearCache();
}
