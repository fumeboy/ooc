/**
 * 对象相关类型定义 (G1, G6)
 *
 * OOC 中的一切实体都是对象。
 * 本文件定义 Stone（静态对象）的数据结构。
 *
 * @ref docs/哲学文档/gene.md#G1 — implements — 对象的组成部分（name, thinkable, talkable, data, relations, traits）
 * @ref docs/哲学文档/gene.md#G2 — implements — StoneData 是 Stone 的静态形态定义
 * @ref docs/哲学文档/gene.md#G6 — implements — Relation 有向关系类型
 */

/** 对外公开的方法描述（仅名称+描述，不含参数） */
export interface TalkableFunction {
  /** 方法名 */
  name: string;
  /** 方法描述 */
  description: string;
}

/** 对外可见的介绍信息 */
export interface Talkable {
  /** 对外的简短介绍 */
  whoAmI: string;
  /** 对外公开的方法列表 */
  functions: TalkableFunction[];
}

/** 思考时的完整自我认知 */
export interface Thinkable {
  /** 对自身的完整说明（仅自己可见） */
  whoAmI: string;
}

/** 与其他对象的有向关系 (G6) */
export interface Relation {
  /** 对方对象名 */
  name: string;
  /** 关系描述 */
  description: string;
}

/** Stone 对象的完整数据结构 (G1, G2) */
export interface StoneData {
  /** 唯一标识符 */
  name: string;
  /** 思考时的自我认知 */
  thinkable: Thinkable;
  /** 对外可见的介绍 */
  talkable: Talkable;
  /** 动态键值对数据 */
  data: Record<string, unknown>;
  /** 与其他对象的关系 */
  relations: Relation[];
  /** trait 名称列表 */
  traits: string[];
  /** 长期记忆索引（memory.md 内容） */
  memory?: string;
}
