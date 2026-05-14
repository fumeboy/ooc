/**
 * windows/ 模块 barrel — 对外暴露 ContextWindow 抽象的所有公共入口。
 *
 * 见 spec docs/superpowers/specs/2026-05-14-context-window-unification-design.md
 */

export type {
  ContextWindow,
  WindowType,
  WindowStatus,
  BaseContextWindow,
  RootWindow,
  CommandExecWindow,
  DoWindow,
  TodoWindow,
} from "./types.js";

export {
  ROOT_WINDOW_ID,
  SESSION_CREATOR_THREAD_ID,
  generateWindowId,
  creatorWindowIdOf,
} from "./types.js";

export {
  registerWindowType,
  getWindowTypeDefinition,
  listRegisteredWindowTypes,
} from "./registry.js";

export type {
  WindowTypeDefinition,
  OnCloseHook,
  OnCloseContext,
  RenderHook,
  RenderContext,
} from "./registry.js";

export { WindowManager } from "./manager.js";

export { initContextWindows } from "./init.js";
export type { InitContextWindowsOpts } from "./init.js";

// Side-effect imports: each window type module 通过 registerWindowType 注入 commands / hooks。
// 这些 import 必须在 WindowManager 之后 load，确保使用时表已就绪。
import "./do.js";
