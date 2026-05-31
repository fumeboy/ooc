/**
 * skill_index window —— 薄注册壳（OOC-4 L4.2c / L6c-1）。
 *
 * 行为真源（renderXml + basicKnowledge + onClose）住 base/skill_index/executable/index.ts，
 * 由活路径沿 base 原型链解析（_shared/behavior.ts）。
 *
 * OOC-4 L6c-1：onClose 已迁出 registry，改由 resolveOnClose 沿链解析（manager.close 兜底）；
 * 薄壳不再 registerWindowType onClose（skill_index 理论上不会被 close，拒绝语义仍由 base 的
 * onCloseSkillIndex 经链提供）。本壳只剩 markRenderXmlViaPrototype——声明 renderXml 由 base
 * 原型链提供，让同步的 assertAllRenderHooksRegistered 不误判缺失（plan D4）。
 */

import { markRenderXmlViaPrototype } from "../_shared/registry.js";

markRenderXmlViaPrototype("skill_index");
