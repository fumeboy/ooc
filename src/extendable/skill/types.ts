/**
 * Skill 类型定义
 *
 * Skill 是纯 prompt 模板，与 Trait 并列独立。
 * Trait 管能力（bias + 方法），Skill 管任务流程指导。
 *
 * @ref docs/superpowers/specs/2026-04-10-skill-system-design.md#3.2
 */

/**
 * Skill 定义（轻量，仅索引信息）
 *
 * 注意：when 字段为自由文本描述，与 TraitDefinition.when（枚举值）语义不同。
 */
export interface SkillDefinition {
  /** Skill 唯一标识 */
  name: string;
  /** 一行描述 */
  description: string;
  /** 使用场景提示（自由文本，非枚举） */
  when?: string;
  /** 文件系统路径（用于按需加载 body） */
  dir: string;
}
