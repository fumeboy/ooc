/**
 * base/skill_index/executable — skill_index 原型的 behavior 真源（OOC-4 L4.2c）。
 *
 * renderXml + basicKnowledge + onClose 的**实现**住这里（物理 move 自 windows/skill_index/index.ts）；
 * 由活路径沿 base 原型链解析（src/executable/windows/_shared/behavior.ts）。
 *
 * onClose 已进 window 定义（OOC-4 L6c-1），由 manager.close 经 resolveOnClose 沿链解析；
 * 薄壳不再 registerWindowType onClose。renderXml/basicKnowledge 同样不进 registry。
 *
 * skill_index 无 method（纯派生索引 window），故 methods 为空。
 */

import type { ObjectWindowDefinition } from "../../../../executable/server/window-types.js";
import type {
  OnCloseContext,
  RenderContext,
} from "../../../../executable/windows/_shared/registry.js";
import type { SkillIndexWindow } from "../../../../executable/windows/skill_index/types.js";
import {
  xmlElement,
  xmlText,
  type XmlNode,
} from "../../../../thinkable/context/xml.js";

/**
 * skill_index 的 basicKnowledge 协议文本。
 */
export const SKILL_INDEX_BASIC_KNOWLEDGE = `
skill_index window 列出当前 stone 上可用的 skills——每个 skill 是一个独立目录（含
SKILL.md + 任意辅助文件），用于复用某种操作模式或协议。

- 来源（双层；同名时 object 级优先）:
  - branch 级（公共，跨 Object 共享）：\`stones/<branch>/skills/<name>/SKILL.md\`
  - object 级（仅 self）：\`stones/<branch>/objects/<self>/skills/<name>/SKILL.md\`
- 索引中可见 name + description（来自 SKILL.md frontmatter）+ scope 徽标（branch / object）
- 进入某 skill：\`exec(command="open_file", args={ path: "<skillFilePath>" })\` 打开 SKILL.md
  阅读完整说明；按需用 \`open_file\` 继续读 references / scripts 等辅助文件
- skills 目录变动 ≤10s 后才反映到索引（缓存 TTL）

如果当前 stone 没有任何 skills，本 window 不会出现。
`.trim();

/**
 * skill_index 的 renderXml hook。
 *
 * 实际派生逻辑放在 synthesizer 里（异步 IO 不适合在 render 层做）；本函数只负责
 * 把已经填好的 window.skills 字段渲染成 XML 子节点序列。
 *
 * 调度器（render.ts）会负责外层 `<window id type status>` + `<title>` + `<commands>`；
 * 本函数返回的是内层 `<hint>` + `<skills>` 子树。
 */
export function renderSkillIndex(ctx: RenderContext): XmlNode[] {
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

/**
 * skill_index 的 onClose hook（L4 排除项；薄壳 import 回去注册到 registry）。
 *
 * skill_index 是 protocol 派生 window；理论上不会被 close（不入 thread.json，每轮重建）。
 * 即使被显式 close，也拒绝（与 root window 同级）。
 */
export function onCloseSkillIndex(_ctx: OnCloseContext): boolean {
  return false;
}

export const window: ObjectWindowDefinition = {
  methods: {},
  renderXml: renderSkillIndex,
  basicKnowledge: SKILL_INDEX_BASIC_KNOWLEDGE,
  onClose: onCloseSkillIndex,
};
