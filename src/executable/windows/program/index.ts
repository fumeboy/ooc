/**
 * program_window —— 薄注册壳（OOC-4 L4.2c）。
 *
 * 行为真源（methods exec/close/set_history_window + renderXml + executeProgramWindowExec）住
 * base/program/executable/index.ts，由活路径沿 base 原型链解析（_shared/behavior.ts）。
 *
 * program 无 onClose / compressView，故本壳只 register `{}`（保持 REGISTRY 入口存在）+
 * markRenderXmlViaPrototype 声明 renderXml 由 base 原型链提供（plan D4）。
 *
 * 留 windows 的跨域共享 helper（runtime.ts / history-viewport.ts）由 base/program/executable
 * + root/command.program + tools/wait import，不在本壳。
 */

import {
  registerWindowType,
  markRenderXmlViaPrototype,
} from "../_shared/registry.js";

registerWindowType("program", {});
markRenderXmlViaPrototype("program");
