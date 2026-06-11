import type { BaseContextWindow } from "@ooc/core/extendable/_shared/types.js";
import type { SkillEntry } from "@ooc/core/persistable/stone-skills.js";

/**
 * Skill 索引窗口（plan §skills 支持）。
 *
 * 每个 thread 启动时由 initContextWindows 自动注入一份，固定 id="skill_index"。
 *
 * **不持久化**：thread.json 序列化时被 strip；reload 后由 initContextWindows 重新插入。
 * 内容（skills 字段）通过 renderXml 阶段动态扫描得出（10s TTL 缓存，详见
 * persistable/stone-skills.ts）。
 *
 * 不注册任何命令；onClose 拒绝（与 root window 同级，与 thread 生命周期同寿）。
 *
 * skills 来源（双层）：
 * - branch 级 `stones/<branch>/skills/<name>/SKILL.md`（跨 Object 共享）
 * - object 级 `stones/<branch>/objects/<self>/skills/<name>/SKILL.md`（仅 self）
 * 同名 skill object 级优先。
 */
export interface SkillIndexWindow extends BaseContextWindow {
  class: "skill_index";
  status: "active";
  /** 派生时已扫描出的 skill 列表（每轮重算）。 */
  skills: SkillEntry[];
}

export type { SkillEntry };
