/**
 * skill_index window —— 薄注册壳（OOC-4 L4.2c）。
 *
 * 行为真源（renderXml + basicKnowledge + onClose）住 base/skill_index/executable/index.ts，
 * 由活路径沿 base 原型链解析（_shared/behavior.ts）。
 *
 * 本壳只做两件事：
 * - 把 base 的 onCloseSkillIndex 注册回 registry（onClose 是 L4 排除项，仍 registry-served；
 *   即使 skill_index 理论上不会被 close，也保留拒绝语义，与 root window 同级）。
 * - markRenderXmlViaPrototype 声明 renderXml 由 base 原型链提供，让同步的
 *   assertAllRenderHooksRegistered 不误判缺失（plan D4）。
 */

import {
  registerWindowType,
  markRenderXmlViaPrototype,
} from "../_shared/registry.js";
import { onCloseSkillIndex } from "../../../extendable/base/skill_index/executable/index.js";

registerWindowType("skill_index", {
  onClose: onCloseSkillIndex,
});

markRenderXmlViaPrototype("skill_index");
