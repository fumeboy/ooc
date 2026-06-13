/**
 * knowledge_base —— readable 维度。无业务数据，只渲染身份/用途；方法菜单由 <window_classes> 声明。
 */
import { builtinRegistry, type RenderContext } from "@ooc/core/extendable/_shared/registry.js";
import { xmlElement, xmlText, type XmlNode } from "@ooc/core/_shared/types/xml.js";

export function readable(_ctx: RenderContext): XmlNode[] {
  return [
    xmlElement("about", {}, [
      xmlText(
        "知识库对象（agent 持有的成员）——可查询知识存储。open_knowledge 把一篇 doc 作为 knowledge 窗引入 context。",
      ),
    ]),
  ];
}

builtinRegistry.registerReadable("knowledge_base", { readable });
