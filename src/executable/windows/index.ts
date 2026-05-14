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
  TalkWindow,
  ProgramWindow,
  FileWindow,
  KnowledgeWindow,
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

export type {
  CommandTableEntry,
  CommandExecutionContext,
  CommandKnowledgeEntries,
} from "./command-types.js";

export { WindowManager } from "./manager.js";

export { initContextWindows } from "./init.js";
export type { InitContextWindowsOpts } from "./init.js";

// root commands 的工具函数（仅服务 root level；非 root window 的 command 通过 WINDOW_REGISTRY 查）
export {
  ROOT_COMMANDS,
  getOpenableCommands,
  deriveRootCommandPaths,
  execRootCommand,
} from "./root/index.js";

// Side-effect imports: each window type module 通过 registerWindowType 注入 commands / hooks。
// 这些 import 必须在 WindowManager 之后 load，确保使用时表已就绪。
//
// root 必须最先 load，因为其它 window type 的 onClose / 注册可能间接依赖 ROOT_COMMANDS
// （目前没有此依赖，但保留这一顺序更稳妥）。
import "./root/index.js";
import "./do.js";
import "./todo.js";
import "./talk.js";
import "./program.js";
import "./file.js";
import "./knowledge.js";
