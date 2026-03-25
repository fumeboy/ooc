/**
 * Stone —— 基础对象 (G1, G2)
 *
 * Stone 是 OOC 的纯粹数据与逻辑载体。
 * 它拥有身份、数据、行为、关系，但不会主动做任何事。
 * Stone 就像一块刻了字的石头：信息在那里，但石头不会自己读出来。
 *
 * @ref docs/哲学文档/gene.md#G1 — implements — 对象的组成部分（name, thinkable, talkable, data, relations）
 * @ref docs/哲学文档/gene.md#G2 — implements — Stone 静态形态（不会主动行动）
 * @ref docs/哲学文档/gene.md#G6 — implements — addRelation 有向关系管理
 * @ref docs/哲学文档/gene.md#G7 — implements — 持久化目录即物理存在（load/save/create）
 * @ref src/types/object.ts — references — StoneData, Talkable, Thinkable, Relation 类型
 * @ref src/persistence/reader.ts — references — readStone 加载
 * @ref src/persistence/writer.ts — references — writeStone 保存
 */

import { join } from "node:path";
import { readStone, writeStone } from "../persistence/index.js";
import type { StoneData, Talkable, Thinkable, Relation } from "../types/index.js";

/** Stone 实例：持有数据并提供操作接口 */
export class Stone {
  /** 对象的持久化目录路径 */
  private readonly _dir: string;
  /** 当前数据快照 */
  private _data: StoneData;

  private constructor(dir: string, data: StoneData) {
    this._dir = dir;
    this._data = data;
  }

  /* ========== 静态工厂方法 ========== */

  /**
   * 从持久化目录加载 Stone
   *
   * @param dir - 对象目录路径（如 stones/researcher/）
   * @returns Stone 实例，若目录不存在返回 null
   */
  static load(dir: string): Stone | null {
    const data = readStone(dir);
    if (!data) return null;
    return new Stone(dir, data);
  }

  /**
   * 创建新的 Stone
   *
   * @param dir - 对象目录路径
   * @param name - 对象名称
   * @param whoAmI - 对象的自我描述
   * @returns 新建的 Stone 实例
   */
  static create(dir: string, name: string, whoAmI: string): Stone {
    const data: StoneData = {
      name,
      thinkable: { whoAmI },
      talkable: { whoAmI: "", functions: [] },
      data: {},
      relations: [],
      traits: [],
    };
    writeStone(dir, data);
    return new Stone(dir, data);
  }

  /* ========== 只读属性 ========== */

  get name(): string { return this._data.name; }
  get dir(): string { return this._dir; }
  get thinkable(): Thinkable { return this._data.thinkable; }
  get talkable(): Talkable { return this._data.talkable; }
  get data(): Record<string, unknown> { return { ...this._data.data }; }
  get relations(): readonly Relation[] { return this._data.relations; }
  get traits(): readonly string[] { return this._data.traits; }

  /** 获取 reflect/ 目录路径（原 effects/_selfmeta，ReflectFlow 数据） */
  get reflectDir(): string { return join(this._dir, "reflect"); }

  /* ========== 数据操作（不可变更新） ========== */

  /**
   * 获取数据字段
   */
  getData(key: string): unknown {
    return this._data.data[key];
  }

  /**
   * 设置数据字段（不可变：创建新的 data 对象）
   */
  setData(key: string, value: unknown): void {
    this._data = {
      ...this._data,
      data: { ...this._data.data, [key]: value },
    };
  }

  /**
   * 更新 talkable 信息
   */
  setTalkable(talkable: Talkable): void {
    this._data = { ...this._data, talkable };
  }

  /**
   * 更新 thinkable 信息
   */
  setThinkable(thinkable: Thinkable): void {
    this._data = { ...this._data, thinkable };
  }

  /**
   * 添加关系
   */
  addRelation(relation: Relation): void {
    this._data = {
      ...this._data,
      relations: [...this._data.relations, relation],
    };
  }

  /* ========== 持久化 ========== */

  /**
   * 保存当前状态到文件系统
   */
  save(): void {
    writeStone(this._dir, this._data);
  }

  /**
   * 从文件系统重新加载状态
   */
  reload(): void {
    const data = readStone(this._dir);
    if (data) {
      this._data = data;
    }
  }

  /**
   * 获取完整的 StoneData 快照
   */
  toJSON(): StoneData {
    return { ...this._data };
  }
}
