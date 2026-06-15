/**
 * skill_index —— stones 上 skills 目录的索引视图的 **object data**（types.ts = 纯 Data）。
 *
 * 只含业务字段；**不含**窗信封字段（id/class/title/status/createdAt）——那些由 runtime 管理。
 *
 * 完全由 synthesizer 派生：每个 thread 每轮渲染时按 thread.persistence 推导 stoneRef，
 * 并行扫描 branch / object 两层 skills 目录（10s TTL 缓存，详见 stone-skills.ts），
 * 合并去重（同名 object 级优先），把派生的 skills 注入这份 Data。**不持久化**。
 *
 * skills 来源（双层）：
 * - workspace 级 `stones/@ooc/skills/<name>/SKILL.md`（跨 Object 共享）
 * - object 级 `stones/<objectId>/skills/<name>/SKILL.md`（仅 self）
 * 同名 skill object 级优先。
 */
import type { SkillEntry } from "@ooc/core/persistable/stone-skills.js";

export interface Data {
  /** 业务态：始终 active（与 thread 生命周期同寿的派生窗）。 */
  status: "active";
  /** 派生时已扫描出的 skill 列表（每轮重算）。 */
  skills: SkillEntry[];
}

export type { SkillEntry };
