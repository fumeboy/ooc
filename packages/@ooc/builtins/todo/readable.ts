// 本文件只导出 readable hook；todo 类的单处声明（registerWindowClass）在 executable/index.ts。
import { type RenderContext } from "@ooc/core/extendable/_shared/registry.js";
import { xmlElement, xmlText, renderPathList, type XmlNode } from "@ooc/core/_shared/types/xml.js";
import type { TodoWindow } from "./types.js";

export function readable(ctx: RenderContext): XmlNode[] {
  const window = ctx.window as TodoWindow;
  const children: XmlNode[] = [
    xmlElement("content", {}, [xmlText(window.content)]),
  ];
  if (window.activatesOn && window.activatesOn.length > 0) {
    children.push(renderPathList("activates_on", window.activatesOn)!);
  }
  return children;
}
