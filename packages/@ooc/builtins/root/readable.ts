import { type RenderContext } from "@ooc/core/extendable/_shared/registry.js";
import type { XmlNode } from "@ooc/core/_shared/types/xml.js";

/**
 * root window 的 readable hook。
 *
 * root 通常不显式渲染（外层包装 + commands 块已经足够说明 root 上可调命令），这里
 * 只返回空 children 数组，让调度器的 commands 子节点自然承担表达。
 *
 * 本文件只导出 readable hook；root 类的单处声明（registerWindowClass）在 executable/index.ts。
 */
export function readable(_ctx: RenderContext): XmlNode[] {
  return [];
}
