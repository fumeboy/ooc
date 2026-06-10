/**
 * windows/ 模块 barrel — 对外暴露 ContextObject 抽象的所有公共入口。
 *
 * 见 spec docs/superpowers/specs/2026-05-14-context-window-unification-design.md
 *
 * 2026-06-03 ooc-6 cleanup Phase A：已删除所有 deprecated alias re-export
 * （ObjectType / ContextObject / ObjectTypeDefinition / ObjectMethod /
 *  MethodExecutionContext / MethodKnowledgeEntries / MethodOutcome）。
 *
 * 2026-06-04 ooc-6 cleanup Phase E：已删除 registry thin wrapper 函数的 re-export
 * （registerObjectType / getObjectDefinition / listRegisteredObjectTypes /
 *  assertAllObjectDefinitionsRegistered / lookupMethod / lookupMethodEntry /
 *  lookupConstructor / resolveParentClassChain / resolveEffectiveVisibleType）。
 * 调用方应直接使用 builtinRegistry.registerExecutable(...) / registerReadable(...) 或 WorldRuntime.objects.*。
 */

export type {
  ContextObject,
  ContextWindow,
  WindowStatus,
  BaseContextWindow,
  RootWindow,
  MethodExecWindow,
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
  ObjectType,
} from "./_shared/types.js";

export {
  ROOT_WINDOW_ID,
  SESSION_CREATOR_THREAD_ID,
  generateWindowId,
  creatorWindowIdOf,
} from "./_shared/types.js";

export {
  builtinRegistry,
  createObjectRegistry,
  filterMethodsByVisibility,
} from "./_shared/registry.js";

export type {
  ObjectDefinition,
  ObjectRegistry,
  OnCloseHook,
  OnCloseContext,
  RenderHook,
  RenderContext,
  ReadableFn,
  MethodVisibilityContext,
} from "./_shared/registry.js";

export type {
  ObjectMethod,
  MethodExecutionContext,
  MethodKnowledgeEntries,
  MethodOutcome,
} from "./_shared/method-types.js";

export { WindowManager } from "./_shared/manager.js";

export { initContextWindows, injectPeerWindowsIfObjectThread } from "./_shared/init.js";
export type { InitContextWindowsOpts } from "./_shared/init.js";

// root methods 的工具函数（仅服务 root level；非 root window 的 method 通过 object registry 查）
export {
  ROOT_METHODS,
  getOpenableMethods,
  deriveRootIntentPaths,
  execRootMethod,
} from "@ooc/builtins/root";

// Side-effect imports: each window type module 通过 builtinRegistry.registerObjectType 注入 methods / hooks。
// 这些 import 必须在 WindowManager 之后 load，确保使用时表已就绪。
//
// root 必须最先 load。
import "@ooc/builtins/root";

// do / talk 是所有 Object 的固有能力。
import "./do/index.js";
import "./talk/index.js";

// P6.§9 (2026-06-02): method_exec form 是 method 调用过程的临时载体（Object 内置特性）。
import "./method_exec/index.js";

// relation window 将在 Phase 6 移除，替换为 peer/children 自动注入
import "./relation/index.js";

// 其余 builtin types 通过 extendable/index.js 加载。
import "../../extendable/index.js";

// Boot-time 校验：所有 object type 必须配齐 renderXml 或 readable hook。
// 延迟到 microtask 执行：本 barrel 与 root/executable / extendable 等存在循环 import，
// 同步在 module-eval 末尾跑 assert 会在某些加载顺序下"过早"触发（彼时 root 等类型尚未
// registerObjectType 完成），assert 抛错反而中断 root/executable 的 eval → ROOT_METHODS
// 永不初始化（TDZ 级联）。queueMicrotask 让整个同步 import 图先 settle 再校验。
import { builtinRegistry as _builtinReg } from "./_shared/registry.js";
queueMicrotask(() => {
  _builtinReg.assertAllObjectDefinitionsRegistered();
});
