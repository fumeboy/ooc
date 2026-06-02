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
  SearchWindow,
  SearchMatch,
  RelationWindow,
  PlanWindow,
  PlanWindowStep,
  // 2026-05-28 ooc-6 Object Unification aliases
  ObjectType,
  ContextObject,
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
  // 2026-05-28 ooc-6 Object Unification aliases
  registerObjectType,
  getObjectDefinition,
  listRegisteredObjectTypes,
  assertAllObjectDefinitionsRegistered,
  lookupMethod,
  lookupMethodEntry,
  // Prototype chain & visibility (Phase 2)
  parseObjectPrototype,
  resolvePrototypeChain,
  resolveObjectMethods,
  filterMethodsByVisibility,
} from "./_shared/registry.js";

export type {
  WindowTypeDefinition,
  OnCloseHook,
  OnCloseContext,
  RenderHook,
  RenderContext,
  // 2026-05-28 ooc-6 Object Unification aliases
  ObjectDefinition,
  ReadableFn,
  MethodVisibilityContext,
} from "./_shared/registry.js";

export type {
  CommandTableEntry,
  CommandExecutionContext,
  CommandKnowledgeEntries,
  CommandExecOutcome,
  // 2026-05-28 ooc-6 Object Unification — canonical names
  ObjectMethod,
  MethodExecutionContext,
  MethodKnowledgeEntries,
  MethodOutcome,
} from "./_shared/command-types.js";

export { WindowManager } from "./_shared/manager.js";

export { initContextWindows } from "./_shared/init.js";
export type { InitContextWindowsOpts } from "./_shared/init.js";

// root commands 的工具函数（仅服务 root level；非 root window 的 command 通过 object registry 查）
export {
  ROOT_COMMANDS,
  ROOT_METHODS,
  getOpenableCommands,
  deriveRootCommandPaths,
  execRootCommand,
} from "@ooc/builtins/root";

// Side-effect imports: each window type module 通过 registerWindowType 注入 commands / hooks。
// 这些 import 必须在 WindowManager 之后 load，确保使用时表已就绪。
//
// root 必须最先 load，因为其它 window type 的 onClose / 注册可能间接依赖 ROOT_COMMANDS
// （目前没有此依赖，但保留这一顺序更稳妥）。
// root 必须最先 load，因为其它 window type 的 onClose / 注册可能间接依赖 ROOT_COMMANDS
// （目前没有此依赖，但保留这一顺序更稳妥）。
// 2026-05-28 ooc-6: root 已迁移为 builtin object
import "@ooc/builtins/root";

// do / talk 是所有 Object 的固有能力，不迁移为独立 builtin object（但仍以 context window 形态呈现）
import "./do/index.js";
import "./talk/index.js";

// relation window 将在 Phase 6 移除，替换为 peer/children 自动注入
import "./relation/index.js";

// 2026-05-28 ooc-6: 其余 builtin types 已迁移为 builtin objects，通过 extendable/index.js → base/index.js 加载
// Extendable 子系统 — 第三方 / 外部世界集成（lark 等）通过 barrel 自注册到 WindowRegistry。
// 必须在 builtin window type 全部加载完成后、boot-time renderXml 校验之前 import。
import "../../extendable/index.js";

// Boot-time 校验：所有 window type 必须配齐 renderXml 或 readable hook（render.ts 调度器要求）。
// 2026-05-28 ooc-6: 有 readable 的 object 可以缺省 renderXml。
import { assertAllObjectDefinitionsRegistered as _assertHooks } from "./_shared/registry.js";
_assertHooks();
