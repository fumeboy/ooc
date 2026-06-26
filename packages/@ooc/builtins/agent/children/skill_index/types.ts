/** skill_index —— agent 能调的 skills 派生索引（运行时聚合，无独立 data）。 */
export interface SkillEntry {
  /** 拥有 skill 的对象 id（context 中的某个窗）。 */
  objectId: string;
  /** 拥有 skill 的 class id。 */
  class: string;
  /** method 名。 */
  method: string;
  /** method description。 */
  description: string;
}

export interface Data {
  skills: SkillEntry[];
}

/**
 * 版本化字段列表（issue C 同伴常量方案 B）。
 *
 * 本 class 全部字段非版本化（运行时载体 / tool-object / sediment 已落 pool）。
 */
export const VERSIONED_FIELDS: readonly (keyof Data)[] = [] as const;
