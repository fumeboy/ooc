/**
 * search_window —— 薄注册壳（OOC-4 L4.2c）。
 *
 * 行为真源（methods close/open_match/set_results_window + renderXml + basicKnowledge +
 * compressView + executeSearchOpenMatch）住 base/search/executable/，由活路径沿 base 原型链解析
 * （_shared/behavior.ts）。set_results_window 命令在 base/search/executable/command.set-results-window.ts。
 *
 * 本壳只做两件事：
 * - 把 base 的 compressSearchWindow 注册回 registry（compressView 是 L4 排除项、仍 registry-served；
 *   render.ts:156 在 compressLevel ≥ 1 时取 def.compressView——不能漏注册，否则压缩态丢折叠渲染）。
 * - markRenderXmlViaPrototype 声明 renderXml 由 base 原型链提供（plan D4）。
 *
 * 留 windows 的跨域共享 helper（results-viewport.ts）由 base/search/executable + root.glob/grep import，
 * 不在本壳。
 */

import {
  registerWindowType,
  markRenderXmlViaPrototype,
} from "../_shared/registry.js";
import { compressSearchWindow } from "../../../extendable/base/search/executable/index.js";

registerWindowType("search", {
  compressView: compressSearchWindow,
});
markRenderXmlViaPrototype("search");
