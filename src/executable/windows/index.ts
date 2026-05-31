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
  TalkWindow,
  ProgramWindow,
  FileWindow,
  KnowledgeWindow,
  SearchWindow,
  SearchMatch,
  RelationWindow,
} from "./_shared/types.js";

export {
  ROOT_WINDOW_ID,
  SESSION_CREATOR_THREAD_ID,
  generateWindowId,
  creatorWindowIdOf,
} from "./_shared/types.js";

export {
  registerWindowType,
  getWindowTypeDefinition,
  listRegisteredWindowTypes,
  assertAllRenderHooksRegistered,
} from "./_shared/registry.js";

export type {
  WindowTypeDefinition,
  OnCloseHook,
  OnCloseContext,
  RenderHook,
  RenderContext,
} from "./_shared/registry.js";

export type {
  MethodEntry,
  MethodExecutionContext,
  MethodKnowledgeEntries,
} from "./_shared/method-types.js";

export { WindowManager } from "./_shared/manager.js";

export { initContextWindows } from "./_shared/init.js";
export type { InitContextWindowsOpts } from "./_shared/init.js";

// root commands 的工具函数（仅服务 root level；非 root window 的 command 通过 WINDOW_REGISTRY 查）
export {
  ROOT_METHODS,
  getOpenableCommands,
  deriveRootMethodPaths,
  execRootMethod,
} from "./root/index.js";

// Side-effect imports: each window type module 通过 registerWindowType 注入 commands / hooks。
// 这些 import 必须在 WindowManager 之后 load，确保使用时表已就绪。
//
// root 必须最先 load，因为其它 window type 的 onClose / 注册可能间接依赖 ROOT_METHODS
// （目前没有此依赖，但保留这一顺序更稳妥）。
import "./root/index.js";
import "./command_exec/index.js";
import "./do/index.js";
import "./talk/index.js";
import "./program/index.js";
import "./file/index.js";
import "./knowledge/index.js";
import "./search/index.js";
import "./relation/index.js";
import "./custom/index.js";
import "./skill_index/index.js";

// Extendable 子系统 — 第三方 / 外部世界集成（lark 等）通过 barrel 自注册到 WindowRegistry。
// 必须在 builtin window type 全部加载完成后、boot-time renderXml 校验之前 import。
import "../../extendable/index.js";

// Boot-time 校验：所有 window type 必须配齐 renderXml hook（render.ts 调度器要求）。
// 缺失会在此 fail-loud（根因 #4 接口 explicit），不让"空白 XML"问题流到 LLM。
import { assertAllRenderHooksRegistered as _assertHooks } from "./_shared/registry.js";
_assertHooks();
