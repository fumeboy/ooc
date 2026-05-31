/**
 * file_window —— 薄注册壳（OOC-4 L4.2c）。
 *
 * 行为真源（methods set_range/set_viewport/reload/edit/close + renderXml + compressView）住
 * base/file/executable/index.ts，由活路径沿 base 原型链解析（_shared/behavior.ts）。
 *
 * 本壳只做两件事：
 * - 把 base 的 compressFileWindow 注册回 registry（compressView 是 L4 排除项、仍 registry-served；
 *   render.ts:156 在 compressLevel ≥ 1 时取 def.compressView——不能漏注册，否则压缩态丢折叠渲染）。
 * - markRenderXmlViaPrototype 声明 renderXml 由 base 原型链提供（plan D4）。
 */

import {
  registerWindowType,
  markRenderXmlViaPrototype,
} from "../_shared/registry.js";
import { compressFileWindow } from "../../../extendable/base/file/executable/index.js";

registerWindowType("file", {
  compressView: compressFileWindow,
});
markRenderXmlViaPrototype("file");
