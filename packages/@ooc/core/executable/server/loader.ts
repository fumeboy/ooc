/**
 * @deprecated (M1 2026-06-02) 直接使用的位置请逐步迁移到
 *   `import { createServerLoader, ServerLoader } from "@ooc/core/runtime/server-loader"`
 *   或通过 `WorldRuntime.serverLoader` 访问 per-world 实例。
 *
 * 本文件保留 module-level wrapper 函数以保证零调用点修改。
 */
import {
  createServerLoader,
  defaultServerLoader,
  ServerLoader,
} from "../../runtime/server-loader.js";
import type { StoneObjectRef, UiMethods } from "./types.js";
import type { ObjectWindowDefinition } from "./window-types.js";
import type { ReadableFn } from "../windows/_shared/registry.js";

export type { ServerLoader };
export { createServerLoader };

/** 动态加载 stone 的 `export const window`，按 mtime 缓存。 */
export async function loadObjectWindow(
  stoneRef: StoneObjectRef,
): Promise<ObjectWindowDefinition | undefined> {
  return defaultServerLoader.loadObjectWindow(stoneRef);
}

/** 动态加载 stone 的 server/index.ts 中 ui_methods。 */
export async function loadUiServerMethods(stoneRef: StoneObjectRef): Promise<UiMethods> {
  return defaultServerLoader.loadUiServerMethods(stoneRef);
}

/** 动态加载 stone 的 readable.ts 导出的渲染函数。 */
export async function loadObjectReadable(stoneRef: StoneObjectRef): Promise<ReadableFn | undefined> {
  return defaultServerLoader.loadObjectReadable(stoneRef);
}

/** 测试钩子：清空 loader 缓存。 */
export function clearServerLoaderCache(): void {
  defaultServerLoader.clearCache();
}
