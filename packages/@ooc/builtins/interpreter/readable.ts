/**
 * interpreter —— readable 维度。无业务数据，只渲染身份/用途；方法菜单由 <window_classes> 声明。
 * 本文件只导出 readable hook；类的单处声明（registerWindowClass）在 executable/index.ts。
 */
import { type RenderContext } from "@ooc/core/extendable/_shared/registry.js";
import { xmlElement, xmlText, type XmlNode } from "@ooc/core/_shared/types/xml.js";

export function readable(_ctx: RenderContext): XmlNode[] {
  return [
    xmlElement("about", {}, [
      xmlText(
        "解释器对象（agent 持有的成员）。run 跑一段 ts/js 脚本——调它会造出 interpreter_process（sandbox + history）。",
      ),
    ]),
  ];
}
