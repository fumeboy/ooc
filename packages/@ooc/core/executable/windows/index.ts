/**
 * windows/ 模块 barrel —— ContextWindow 抽象 + builtin class 装载入口。
 *
 * 两职：
 * 1. 对外暴露 ContextWindow 类型 / WindowManager / init / projection 等公共入口。
 * 2. **装载全部 builtin class**：root / pr / thread（唯一会话载体）等核心载体 + 各窗类型
 *    （file / plan / search / … + 飞书 feishu_chat / feishu_doc + 单例 feishu_app）一处
 *    `builtinRegistry.register(...)` 显式装载。talk / reflect_request 不再是注册 class——它们是
 *    thread readable 按视角投影出的 window class。
 *
 * Wave 4 对象模型重构已删除旧 deferred-hook 类型 re-export（ObjectDefinition / OnCloseHook /
 * RenderContext / ReadableFn）与旧 root method re-export（ROOT_METHODS / getOpenableMethods /
 * deriveRootIntentPaths / execRootMethod）——它们随旧 ObjectDefinition 契约一并废弃。
 */

export type {
  ContextWindow,
  OocObjectInstance,
  WindowStatus,
  BaseContextWindow,
  SearchMatch,
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

import { Class as KnowledgeClass } from "@ooc/builtins/knowledge";
import { Class as FileClass } from "@ooc/builtins/file";
import { Class as TodoClass } from "@ooc/builtins/todo";
import { Class as SearchClass } from "@ooc/builtins/search";
import { Class as SkillIndexClass } from "@ooc/builtins/skill_index";
import { Class as PlanClass } from "@ooc/builtins/plan";
import { Class as TerminalProcessClass } from "@ooc/builtins/terminal_process";
import { Class as InterpreterProcessClass } from "@ooc/builtins/interpreter_process";
import { Class as FilesystemClass } from "@ooc/builtins/filesystem";
import { Class as TerminalClass } from "@ooc/builtins/terminal";
import { Class as InterpreterClass } from "@ooc/builtins/interpreter";
import { Class as RuntimeClass } from "@ooc/builtins/runtime";
import { Class as KnowledgeBaseClass } from "@ooc/builtins/knowledge_base";
import { Class as ThreadClass } from "@ooc/builtins/thread";

import { Class as FeishuChatClass } from "@ooc/builtins/feishu_chat";
import { Class as FeishuDocClass } from "@ooc/builtins/feishu_doc";
import { Class as FeishuAppClass } from "@ooc/builtins/feishu_app";

import { Class as AgentClass } from "@ooc/builtins/agent";

// root 是继承链终点基类（BASE_CLASS_ANCHOR 已 parentClass:null）；合入 root 的 executable/readable。
_reg.register("_builtin/root", RootClass, { parentClass: null });
// agent：OOC Agent 基类，承载 agency（talk/plan/todo/end）；继承 root。
// 旧 extendable/index.ts 从未注册它（agent 仅作空 BASE_CLASS_ANCHOR），导致 supervisor/feishu_app
// 等 agent 实例解析不到 agency——此处显式 register 补回。
_reg.register("_builtin/agent", AgentClass);
// pr：reviewer 评审窗（隐式继承 root）。
_reg.register("_builtin/pr", PrClass);

// method_exec 模块已删除（Wave 4 裁决：form 收集机制废弃，method 参数经 exec 直传 args）。
// method_exec 仍作 BASE_CLASS_ANCHOR 保留在 object-registry，但无 methods/readable。

// 各窗类型 builtin class（继承父类取各包 package.json `ooc.class`，缺省 → 隐式 root）。
_reg.register("_builtin/knowledge", KnowledgeClass);
_reg.register("_builtin/file", FileClass);
_reg.register("_builtin/todo", TodoClass);
_reg.register("_builtin/search", SearchClass);
_reg.register("_builtin/skill_index", SkillIndexClass);
_reg.register("_builtin/plan", PlanClass);
_reg.register("_builtin/terminal_process", TerminalProcessClass);
_reg.register("_builtin/interpreter_process", InterpreterProcessClass);
_reg.register("_builtin/filesystem", FilesystemClass);
_reg.register("_builtin/terminal", TerminalClass);
_reg.register("_builtin/interpreter", InterpreterClass);
_reg.register("_builtin/runtime", RuntimeClass);
_reg.register("_builtin/knowledge_base", KnowledgeBaseClass);
// thread：**唯一**会话载体注册 class（talk/reflect_request 是它 readable 投影出的 window class，
// 非注册 class）。继承 root 缺省；isBuiltinFeature=固有特性，会话窗状态 inline 进所属 thread 的
// thread-context.json，不写独立 stone dir。
_reg.register("_builtin/thread", ThreadClass, { isBuiltinFeature: true });

// 飞书集成：feishu_chat / feishu_doc 是窗类型（parentClass:null，由 feishu_app 开出）；
// feishu_app 是带 own method 的单例 object，注册为继承 agent 的 class（实例 class="feishu_app"
// 解析 own open_chat/open_doc + 继承 agent 的 agency）。
_reg.register("_builtin/feishu_chat", FeishuChatClass, { parentClass: null });
_reg.register("_builtin/feishu_doc", FeishuDocClass, { parentClass: null });
_reg.register("feishu_app", FeishuAppClass, { parentClass: "_builtin/agent" });
