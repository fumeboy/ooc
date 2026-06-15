/**
 * windows/ 模块 barrel —— ContextWindow 抽象 + builtin class 装载入口。
 *
 * 两职：
 * 1. 对外暴露 ContextWindow 类型 / WindowManager / init / projection 等公共入口。
 * 2. **装载核心 builtin class**：root / pr / reflect_request 经 `export const Class` 显式
 *    `builtinRegistry.register(...)`；talk / method_exec 等核心载体经 side-effect import 注册；
 *    其余 builtin 经 `../../extendable/index.js` 装载。
 *
 * Wave 4 对象模型重构已删除旧 deferred-hook 类型 re-export（ObjectDefinition / OnCloseHook /
 * RenderContext / ReadableFn）与旧 root method re-export（ROOT_METHODS / getOpenableMethods /
 * deriveRootIntentPaths / execRootMethod）——它们随旧 ObjectDefinition 契约一并废弃。
 */

export type {
  ContextWindow,
  WindowStatus,
  BaseContextWindow,
  RootWindow,
  TodoWindow,
  TalkWindow,
  PrWindow,
  TerminalProcessWindow,
  InterpreterProcessWindow,
  FileWindow,
  KnowledgeWindow,
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
  RegisteredClass,
  MethodVisibilityContext,
} from "./_shared/registry.js";

export type {
  ObjectMethod,
  MethodExecutionContext,
  MethodOutcome,
} from "./_shared/method-types.js";

export { WindowManager } from "./_shared/manager.js";

export { initContextWindows, injectPeerWindowsIfObjectThread, injectMemberWindowsIfObjectThread } from "./_shared/init.js";
export type { InitContextWindowsOpts } from "./_shared/init.js";

// talk-family 投影 class 的唯一计算入口（context.md core 7：class 不持久化，每次构造/读回时算）。
export { computeProjectionClass } from "./_shared/projection-class.js";
export type { ProjectionClass } from "./_shared/projection-class.js";

// ─────────────────────────── builtin class 装载 ───────────────────────────
// 每个 builtin 包导出 `export const Class: OocClass`；一处 builtinRegistry.register 装载。
// 装载键名传原始 objectId（含 `_builtin/`），registry 内部归一。

import { builtinRegistry as _reg } from "./_shared/registry.js";
import { Class as RootClass } from "@ooc/builtins/root";
import { Class as PrClass } from "@ooc/builtins/pr";
import { Class as ReflectRequestClass } from "@ooc/builtins/reflect_request";

// root 是继承链终点基类（BASE_CLASS_ANCHOR 已 parentClass:null）；合入 root 的 executable/readable。
_reg.register("_builtin/root", RootClass, { parentClass: null });
// pr：reviewer 评审窗（隐式继承 root）。
_reg.register("_builtin/pr", PrClass);
// reflect_request：super flow 反思会话窗（继承 _builtin/thread → talk）。
_reg.register("_builtin/reflect_request", ReflectRequestClass, { parentClass: "_builtin/thread" });

// talk 是所有 Agent 的固有能力（统一 peer 会话 + fork 子线程两形态）——核心载体，side-effect 注册。
import "./talk/index.js";
// method_exec 模块已删除（Wave 4 裁决：form 收集机制废弃，method 参数经 exec 直传 args）。
// method_exec 仍作 BASE_CLASS_ANCHOR 保留在 object-registry，但无 methods/readable。

// 其余 builtin class 通过 extendable/index.js 装载（含 thread / file / plan / … + 外部集成）。
import "../../extendable/index.js";
