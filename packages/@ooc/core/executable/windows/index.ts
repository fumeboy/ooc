/**
 * windows/ 模块 barrel — 对外暴露 ContextWindow 抽象的所有公共入口。
 *
 * 已删除所有 deprecated alias re-export
 * （string / ContextObject / ObjectTypeDefinition / ObjectMethod /
 *  MethodExecutionContext / MethodOutcome）。
 *
 * 已删除 registry thin wrapper 函数的 re-export
 * （registerObjectType / getObjectDefinition / listRegisteredObjectTypes /
 *  assertAllObjectDefinitionsRegistered / lookupMethod / lookupMethodEntry /
 *  lookupConstructor / resolveParentClassChain / resolveEffectiveVisibleType）。
 * 调用方应直接使用 builtinRegistry.registerExecutable(...) / registerReadable(...)。
 */

export type {
  ContextWindow,
  WindowStatus,
  BaseContextWindow,
  RootWindow,
  MethodExecWindow,
  DoWindow,
  TodoWindow,
  TalkWindow,
  PrWindow,
  ProgramWindow,
  FileWindow,
  KnowledgeWindow,
  SearchWindow,
  SearchMatch,
  PlanWindow,
  PlanWindowStep,
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
  RenderContext,
  ReadableFn,
  MethodVisibilityContext,
} from "./_shared/registry.js";

export type {
  ObjectMethod,
  MethodExecutionContext,
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

// Side-effect imports: each window type module 通过 builtinRegistry.registerExecutable 注入 methods / hooks。
// 这些 import 必须在 WindowManager 之后 load，确保使用时表已就绪。
//
// root 必须最先 load。
import "@ooc/builtins/root";

// do / talk 是所有 Object 的固有能力。
import "./do/index.js";
import "./talk/index.js";
// reflectable 维度的 window 家族（pr 评审窗 + reflect_request 反思会话窗）——
// 物理寄居 @ooc/core/reflectable/，经 barrel side-effect 注册到 builtinRegistry。
import "@ooc/core/reflectable/index.js";

// method_exec form 是 method 调用过程的临时载体（Object 内置特性）。
import "./method_exec/index.js";


// 其余 builtin types 通过 extendable/index.js 加载。
import "../../extendable/index.js";

// Boot-time 校验：所有 object type 必须配齐 readable hook。
// 延迟到 microtask 执行：本 barrel 与 root/executable / extendable 等存在循环 import，
// 同步在 module-eval 末尾跑 assert 会在某些加载顺序下"过早"触发（彼时 root 等类型尚未
// registerExecutable 完成），assert 抛错反而中断 root/executable 的 eval → ROOT_METHODS
// 永不初始化（TDZ 级联）。queueMicrotask 让整个同步 import 图先 settle 再校验。
import { builtinRegistry as _builtinReg } from "./_shared/registry.js";
queueMicrotask(() => {
  _builtinReg.assertAllObjectDefinitionsRegistered();
});
