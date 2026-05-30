/**
 * skill_index window —— stones 上 skills 目录的索引视图（plan §skills 支持）。
 *
 * 形态决策（D2 + 用户补充）：
 * - **完全由 synthesizer 派生**：每轮渲染时按 thread.persistence 推导 stoneRef，
 *   并行扫描 branch / object 两层 skills 目录（10s TTL 缓存，详见 stone-skills.ts）；
 *   合并去重（同名 object 级优先），把派生的 SkillIndexWindow 插入 enriched
 *   contextWindows 视图。
 * - **如果两层都没有 skills，跳过注入**——避免空白 window 占 context；
 * - **不持久化**：thread.json 中不出现该 window；synthesizer 在每轮 collect 时按需重建；
 * - 不注册任何 command；onClose 拒绝（与 root 同级；理论上不会被尝试 close）。
 *
 * UI 端类似——ContextSnapshotViewer 渲染时如果 skills 为空就不显示卡片。
 */

import {
  registerWindowType,
  markRenderXmlViaPrototype,
  type OnCloseContext,
  type RenderContext,
} from "../_shared/registry.js";
import type { SkillIndexWindow } from "./types.js";
import { xmlElement, xmlText, type XmlNode } from "../../../thinkable/context/xml.js";

/**
 * skill_index 的 basicKnowledge 协议文本。
 *
 * OOC-4 L4.1：行为真源迁到 base/skill_index/executable/index.ts（沿原型链解析），
 * 本常量保留 export 供 base proto import 复用（逐字保真，避免 copy 漂移）。
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

function onCloseSkillIndex(_ctx: OnCloseContext): boolean {
  // skill_index 是 protocol 派生 window；理论上不会被 close（不入 thread.json，每轮重建）
  // 即使被显式 close，也拒绝（与 root window 同级）
  return false;
}

// OOC-4 L4.1：renderXml + basicKnowledge + methods 已从 registry 移走，
// 改由 base/skill_index/executable/index.ts 沿原型链解析（behavior.ts:resolveRenderXml /
// resolveBasicKnowledge）。registry 入口仅保留 onClose（L4 排除项，仍走 registry）。
registerWindowType("skill_index", {
  onClose: onCloseSkillIndex,
});

// 声明 renderXml 由 base 原型链提供，让同步的 assertAllRenderHooksRegistered 不误判缺失（plan D4）。
markRenderXmlViaPrototype("skill_index");
