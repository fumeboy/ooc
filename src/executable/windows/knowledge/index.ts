/**
 * knowledge_window —— 薄注册壳（OOC-4 L4.2c）。
 *
 * 行为真源（methods reload/close/set_viewport + renderXml + onClose）住
 * base/knowledge/executable/index.ts，由活路径沿 base 原型链解析（_shared/behavior.ts）。
 *
 * 本壳只做两件事：
 * - 把 base 的 onCloseKnowledgeWindow 注册回 registry（onClose 是 L4 排除项、仍 registry-served；
 *   manager.ts close 时取 def.onClose 拒绝非 explicit 来源——不能漏注册，否则 protocol/activator
 *   knowledge_window 可被误关）。
 * - markRenderXmlViaPrototype 声明 renderXml 由 base 原型链提供（plan D4）。
 */

import {
  registerWindowType,
  markRenderXmlViaPrototype,
} from "../_shared/registry.js";
import { onCloseKnowledgeWindow } from "../../../extendable/base/knowledge/executable/index.js";

registerWindowType("knowledge", {
  onClose: onCloseKnowledgeWindow,
});
markRenderXmlViaPrototype("knowledge");
