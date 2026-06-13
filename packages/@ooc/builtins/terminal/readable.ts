/**
 * terminal —— readable 维度。无业务数据，只渲染身份/用途；方法菜单由 <window_classes> 声明。
 */
import { builtinRegistry, type RenderContext } from "@ooc/core/extendable/_shared/registry.js";
import { xmlElement, xmlText, type XmlNode } from "@ooc/core/_shared/types/xml.js";

export function readable(_ctx: RenderContext): XmlNode[] {
  return [
    xmlElement("about", {}, [
      xmlText(
        "终端对象（agent 持有的成员）。program 运行 shell/ts/js——调它会造出 program 对象（执行 + history）。",
      ),
    ]),
  ];
}

builtinRegistry.registerReadable("terminal", { readable });
