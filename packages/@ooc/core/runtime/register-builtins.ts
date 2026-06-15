/**
 * builtin class 装载入口 —— 一处 `builtinRegistry.register(...)` 显式装载全部 builtin class。
 *
 * 每个 builtin 包导出 `export const Class: OocClass`；本模块把它们注册进进程级 `builtinRegistry`。
 * 装载键名传原始 objectId（含 `_builtin/`），registry 内部归一。
 *
 * 核心载体 + 各窗类型（file / plan / search / … + 飞书 feishu_chat / feishu_doc + 单例
 * feishu_app）一处装载。talk / reflect_request **不是**注册 class——它们是 thread readable 按
 * 视角投影出的 window class（context.md 核心 2/8/9）。
 *
 * 依赖本注册副作用的调用方（worker / loader / 测试）`import "@ooc/core/runtime/register-builtins.js"`，
 * 保证 side-effect 注册在 load 期触发。
 */

import { builtinRegistry as _reg } from "./object-registry.js";
import { Class as RootClass } from "@ooc/builtins/root";
import { Class as PrClass } from "@ooc/builtins/agent/pr";

import { Class as KnowledgeClass } from "@ooc/builtins/knowledge_base/knowledge";
import { Class as FileClass } from "@ooc/builtins/filesystem/file";
import { Class as TodoClass } from "@ooc/builtins/agent/todo";
import { Class as MethodExecFormClass } from "@ooc/builtins/agent/method_exec_form";
import { Class as SearchClass } from "@ooc/builtins/filesystem/search";
import { Class as SkillIndexClass } from "@ooc/builtins/agent/skill_index";
import { Class as PlanClass } from "@ooc/builtins/agent/plan";
import { Class as TerminalProcessClass } from "@ooc/builtins/terminal/terminal_process";
import { Class as InterpreterProcessClass } from "@ooc/builtins/interpreter/interpreter_process";
import { Class as FilesystemClass } from "@ooc/builtins/filesystem";
import { Class as TerminalClass } from "@ooc/builtins/terminal";
import { Class as InterpreterClass } from "@ooc/builtins/interpreter";
import { Class as RuntimeClass } from "@ooc/builtins/runtime";
import { Class as KnowledgeBaseClass } from "@ooc/builtins/knowledge_base";
import { Class as ThreadClass } from "@ooc/builtins/agent/thread";

import { Class as FeishuChatClass } from "@ooc/builtins/feishu_app/feishu_chat";
import { Class as FeishuDocClass } from "@ooc/builtins/feishu_app/feishu_doc";
import { Class as FeishuAppClass } from "@ooc/builtins/feishu_app";

import { Class as AgentClass } from "@ooc/builtins/agent";

// root 是继承链终点基类（BASE_CLASS_ANCHOR 已 parentClass:null）；合入 root 的 executable/readable。
_reg.register("_builtin/root", RootClass, { parentClass: null });
// agent：OOC Agent 基类，承载 agency（talk/plan/todo/end）；继承 root。
_reg.register("_builtin/agent", AgentClass);
// pr：reviewer 评审窗（隐式继承 root）。
_reg.register("_builtin/agent/pr", PrClass);

// 各窗类型 builtin class（继承父类取各包 package.json `ooc.class`，缺省 → 隐式 root）。
_reg.register("_builtin/knowledge_base/knowledge", KnowledgeClass);
_reg.register("_builtin/filesystem/file", FileClass);
_reg.register("_builtin/agent/todo", TodoClass);
// method_exec_form：method 调用 form（占位 class；form 机制 Wave4 已废，仅类型归位）。
_reg.register("_builtin/agent/method_exec_form", MethodExecFormClass);
_reg.register("_builtin/filesystem/search", SearchClass);
_reg.register("_builtin/agent/skill_index", SkillIndexClass);
_reg.register("_builtin/agent/plan", PlanClass);
_reg.register("_builtin/terminal/terminal_process", TerminalProcessClass);
_reg.register("_builtin/interpreter/interpreter_process", InterpreterProcessClass);
_reg.register("_builtin/filesystem", FilesystemClass);
_reg.register("_builtin/terminal", TerminalClass);
_reg.register("_builtin/interpreter", InterpreterClass);
_reg.register("_builtin/runtime", RuntimeClass);
_reg.register("_builtin/knowledge_base", KnowledgeBaseClass);
// thread：**唯一**会话载体注册 class（talk/reflect_request 是它 readable 投影出的 window class，
// 非注册 class）。继承 root 缺省；inline 持久化由 ThreadClass.persistable.mode="inline" 自声明。
_reg.register("_builtin/agent/thread", ThreadClass);

// 飞书集成：feishu_chat / feishu_doc 是窗类型（parentClass:null，由 feishu_app 开出）；
// feishu_app 是带 own method 的单例 object，注册为继承 agent 的 class。
_reg.register("_builtin/feishu_app/feishu_chat", FeishuChatClass, { parentClass: null });
_reg.register("_builtin/feishu_app/feishu_doc", FeishuDocClass, { parentClass: null });
_reg.register("feishu_app", FeishuAppClass, { parentClass: "_builtin/agent" });
