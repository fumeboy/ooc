/**
 * skill_index —— stones 上 skills 目录的索引视图的 **object data**（types.ts = 纯 Data）。
 *
 * 只含业务字段；**不含**窗信封字段（id/class/title/status/createdAt）——那些由 runtime 管理。
 *
 * skills 由 skill_index 的 **readable 渲染期自算**：按 thread.persistence 推导 stoneRef，
 * 并行扫描 workspace / object / external 三层 skills 目录（10s TTL 缓存，详见 ./scan.ts），
 * 合并去重（external < workspace < object，specificity 递增）。**不持久化**。
 *
 * skills 来源（三层）：
 * - workspace 级 `stones/@ooc/skills/<name>/SKILL.md`（跨 Object 共享）
 * - object 级 `stones/<objectId>/skills/<name>/SKILL.md`（仅 self）
 * - external 级 `.world.json` 的 externalSkillsDir 指定目录
 * 同名 skill：object > workspace > external。
 */

/** 单个 skill 索引项（SkillEntry）。 */
export interface SkillEntry {
  /** skill 名（目录名）。 */
  name: string;
  /** SKILL.md frontmatter 的 description；缺失或解析失败时为 "(无描述)"。 */
  description: string;
  /** SKILL.md 的绝对路径，用作 open_file 提示。 */
  skillFilePath: string;
  /**
   * 来源 scope：
   * - workspace — 公共：stones/@ooc/skills/<name>/SKILL.md（原 branch）
   * - object  — 私有：stones/<objectId>/skills/<name>/SKILL.md
   * - external — 外部目录：由 .world.json 的 externalSkillsDir 指定（与 stone 无关）
   */
  scope: "workspace" | "object" | "external";
}

export interface Data {
  /** 业务态：始终 active（与 thread 生命周期同寿的派生窗）。 */
  status: "active";
  /** 派生时已扫描出的 skill 列表（每轮重算）。 */
  skills: SkillEntry[];
}
