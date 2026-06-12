/**
 * filesystem —— readable 维度。
 *
 * filesystem 窗无业务数据，readable 只渲染它的身份/用途，方法菜单由渲染层的
 * `<window_classes>` 按 class 声明一次（不在此逐实例重复）。
 * boot 校验要求每个 object type 配齐 readable hook，故本文件必需。
 */
import { builtinRegistry, type RenderContext } from "@ooc/core/extendable/_shared/registry.js";
import { xmlElement, xmlText, type XmlNode } from "@ooc/core/_shared/types/xml.js";

export function readable(_ctx: RenderContext): XmlNode[] {
  return [
    xmlElement("about", {}, [
      xmlText(
        "文件系统对象（agent 持有的成员）。grep / glob 查询、open_file / write_file 读写——" +
          "调它的方法会造出 search / file 对象。",
      ),
    ]),
  ];
}

builtinRegistry.registerReadable("filesystem", { readable });
