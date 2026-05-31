/**
 * search_window —— 薄注册壳（OOC-4 L4.2c / L6c-1）。
 *
 * 行为真源（methods close/open_match/set_results_window + renderXml + basicKnowledge +
 * compressView + executeSearchOpenMatch）住 base/search/executable/，由活路径沿 base 原型链解析
 * （_shared/behavior.ts）。set_results_window 命令在 base/search/executable/command.set-results-window.ts。
 *
 * OOC-4 L6c-1：compressView 已迁出 registry，改由 resolveCompressView 沿链解析（render.ts 兜底）；
 * 薄壳不再 registerWindowType compressView。本壳只剩 markRenderXmlViaPrototype——声明 renderXml
 * 由 base 原型链提供（plan D4）。
 *
 * 留 windows 的跨域共享 helper（results-viewport.ts）由 base/search/executable + root.glob/grep import，
 * 不在本壳。
 */

import { markRenderXmlViaPrototype } from "../_shared/registry.js";

markRenderXmlViaPrototype("search");
