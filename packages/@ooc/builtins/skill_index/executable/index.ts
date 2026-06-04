/**
 * skill_index object —— stones 上 skills 目录的索引视图（plan §skills 支持）。
 *
 * 2026-05-28 ooc-6 Object Unification: 从 builtin window 迁移为 builtin object。
 *
 * 形态决策：
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

import { builtinRegistry, type OnCloseContext } from "@ooc/core/extendable/_shared/registry.js";
import { readable } from "../readable.js";

const SKILL_INDEX_BASIC_KNOWLEDGE = `
skill_index object 列出当前 stone 上可用的 skills——每个 skill 是一个独立目录（含
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

/** skill_index 的 renderXml hook 已迁出到 ../readable.ts。 */

function onCloseSkillIndex(_ctx: OnCloseContext): boolean {
  // skill_index 是 protocol 派生 window；理论上不会被 close（不入 thread.json，每轮重建）
  // 即使被显式 close，也拒绝（与 root window 同级）
  return false;
}

builtinRegistry.registerObjectType("skill_index", {
  methods: {},
  onClose: onCloseSkillIndex,
  readable,
  basicKnowledge: SKILL_INDEX_BASIC_KNOWLEDGE,
});
