/**
 * extendable —— 第三方 / 外部世界 集成的扩展层。
 *
 * 与 OOC 核心维度平行：核心维度回答"OOC Agent 自身能干什么"，extendable 回答"OOC 如何吃下
 * 外部世界（外部 SaaS / CLI / SDK）"。
 *
 * 本 barrel 兼两职：
 * 1. **装载一批 builtin class**（原 builtin windows）—— 显式 import 各包的 `export const Class`
 *    + 把它注册进 `builtinRegistry`（键名=原始 objectId，含 `_builtin/` 前缀；registry 内部归一）。
 *    继承父类来自各包 package.json 的 `ooc.class`（缺省 → 隐式 root）。
 * 2. 拉起外部集成子目录（lark 等）的 side-effect 注册。
 *
 * 由 src/executable/windows/index.ts 在 root / talk / method_exec 装载后拉起。
 */

import { builtinRegistry } from "../runtime/object-registry.js";

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

// 装载清单：[原始 objectId, Class, 继承父类]（父类取自各包 package.json `ooc.class`；缺省 → 隐式 root）。
builtinRegistry.register("_builtin/knowledge", KnowledgeClass);
builtinRegistry.register("_builtin/file", FileClass);
builtinRegistry.register("_builtin/todo", TodoClass);
builtinRegistry.register("_builtin/search", SearchClass);
builtinRegistry.register("_builtin/skill_index", SkillIndexClass);
builtinRegistry.register("_builtin/plan", PlanClass);
builtinRegistry.register("_builtin/terminal_process", TerminalProcessClass);
builtinRegistry.register("_builtin/interpreter_process", InterpreterProcessClass);
builtinRegistry.register("_builtin/filesystem", FilesystemClass);
builtinRegistry.register("_builtin/terminal", TerminalClass);
builtinRegistry.register("_builtin/interpreter", InterpreterClass);
builtinRegistry.register("_builtin/runtime", RuntimeClass);
builtinRegistry.register("_builtin/knowledge_base", KnowledgeBaseClass);
// thread 继承 talk（package.json ooc.class: "talk"）。
builtinRegistry.register("_builtin/thread", ThreadClass, { parentClass: "talk" });

// 外部集成子目录（飞书等）：side-effect 注册。
import "./lark/index.js";
