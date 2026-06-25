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
