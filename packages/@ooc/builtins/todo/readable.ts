import { type RenderContext } from "@ooc/core/extendable/_shared/registry.js";
import { xmlElement, xmlText, renderPathList, type XmlNode } from "@ooc/core/thinkable/context/xml.js";
import type { TodoWindow } from "./types.js";

export function readable(ctx: RenderContext): XmlNode[] {
  const window = ctx.window as TodoWindow;
  const children: XmlNode[] = [
    xmlElement("content", {}, [xmlText(window.content)]),
  ];
  if (window.onMethodPath && window.onMethodPath.length > 0) {
    children.push(renderPathList("on_command_path", window.onMethodPath)!);
  }
  return children;
}
