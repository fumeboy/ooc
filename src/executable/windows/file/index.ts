/**
 * file_window —— 薄注册壳（OOC-4 L4.2c / L6c-1）。
 *
 * 行为真源（methods set_range/set_viewport/reload/edit/close + renderXml + compressView）住
 * base/file/executable/index.ts，由活路径沿 base 原型链解析（_shared/behavior.ts）。
 *
 * OOC-4 L6c-1：compressView 已迁出 registry，改由 resolveCompressView 沿链解析（render.ts 兜底）；
 * 薄壳不再 registerWindowType compressView。本壳只剩 markRenderXmlViaPrototype——声明 renderXml
 * 由 base 原型链提供（plan D4）。
 */

import { markRenderXmlViaPrototype } from "../_shared/registry.js";

markRenderXmlViaPrototype("file");
