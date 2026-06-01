import { type RenderContext } from "@ooc/core/extendable/_shared/registry.js";
import type { SkillIndexWindow } from "./types.js";
import { xmlElement, xmlText, type XmlNode } from "@ooc/core/thinkable/context/xml.js";

/**
 * skill_index 的 readable hook。
 *
 * 实际派生逻辑放在 synthesizer 里（异步 IO 不适合在 render 层做）；本函数只负责
 * 把已经填好的 window.skills 字段渲染成 XML 子节点序列。
 */
export function readable(ctx: RenderContext): XmlNode[] {
  const window = ctx.window as SkillIndexWindow;
  const skills = window.skills ?? [];
  return [
    xmlElement("hint", {}, [
      xmlText(
        '使用 exec(command="open_file", args={ path: "<skillFilePath>" }) 打开具体 SKILL.md 阅读完整说明',
      ),
    ]),
    xmlElement(
      "skills",
      { count: String(skills.length) },
      skills.map((s) =>
        xmlElement(
          "skill",
          { name: s.name, scope: s.scope, path: s.skillFilePath },
          [xmlElement("description", {}, [xmlText(s.description)])],
        ),
      ),
    ),
  ];
}
