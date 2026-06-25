/**
 * Builtin class 装载入口 —— 一处显式 register 全部 builtin class。
 *
 * 每个 builtin 包导出 `export const Class: OocClass`；本模块在 load 期 side-effect 注册进
 * 进程级 `builtinClassRegistry`（见 `object-registry.ts`）。
 *
 * 依赖本注册副作用的调用方（worker / 测试 / loader）：
 *   `import "@ooc/core/runtime/object-register.builtins.js"`
 */

import { builtinClassRegistry } from "./object-registry.js";

// agent 家族
import { Class as AgentClass } from "@ooc/builtins/agent";
import { Class as ThreadClass } from "@ooc/builtins/agent/thread";
import { Class as TodoClass } from "@ooc/builtins/agent/todo";
import { Class as PlanClass } from "@ooc/builtins/agent/plan";
import { Class as SkillIndexClass } from "@ooc/builtins/agent/skill_index";
import { Class as MethodExecFormClass } from "@ooc/builtins/agent/method_exec_form";
import { Class as PrClass } from "@ooc/builtins/agent/pr";

// tool-object 家族
import { Class as FilesystemClass } from "@ooc/builtins/filesystem";
import { Class as FileClass } from "@ooc/builtins/filesystem/file";
import { Class as SearchClass } from "@ooc/builtins/filesystem/search";
import { Class as TerminalClass } from "@ooc/builtins/terminal";
import { Class as TerminalProcessClass } from "@ooc/builtins/terminal/terminal_process";
import { Class as InterpreterClass } from "@ooc/builtins/interpreter";
import { Class as InterpreterProcessClass } from "@ooc/builtins/interpreter/interpreter_process";
import { Class as KnowledgeBaseClass } from "@ooc/builtins/knowledge_base";
import { Class as KnowledgeClass } from "@ooc/builtins/knowledge_base/knowledge";
import { Class as RuntimeClass } from "@ooc/builtins/runtime";

// agent class —— object 经 ooc.class 继承即成 agent 实例。
builtinClassRegistry.register(AgentClass);
// thread —— 唯一会话载体注册 class（talk / reflect_request 是它 readable 投影出的 window class）。
builtinClassRegistry.register(ThreadClass);
// agent children
builtinClassRegistry.register(TodoClass);
builtinClassRegistry.register(PlanClass);
builtinClassRegistry.register(SkillIndexClass);
builtinClassRegistry.register(MethodExecFormClass);
builtinClassRegistry.register(PrClass);

// tool objects 和 children 窗类。
builtinClassRegistry.register(FilesystemClass);
builtinClassRegistry.register(FileClass);
builtinClassRegistry.register(SearchClass);
builtinClassRegistry.register(TerminalClass);
builtinClassRegistry.register(TerminalProcessClass);
builtinClassRegistry.register(InterpreterClass);
builtinClassRegistry.register(InterpreterProcessClass);
builtinClassRegistry.register(KnowledgeBaseClass);
builtinClassRegistry.register(KnowledgeClass);
builtinClassRegistry.register(RuntimeClass);
