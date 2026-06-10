import { builtinRegistry, type RenderContext } from "@ooc/core/extendable/_shared/registry.js";
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

// readable 维度自注册（todo 仅有 readable，无 window method / compressView）。
builtinRegistry.registerReadable("todo", { readable });
