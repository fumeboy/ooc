/**
 * 对象注册表
 *
 * 管理所有 Stone 对象的加载和查找。
 *
 * @ref .ooc/docs/哲学文档/gene.md#G1 — implements — 对象注册与通讯录（DirectoryEntry）
 * @ref .ooc/docs/哲学文档/gene.md#G7 — references — 从 stones/ 目录扫描加载
 * @ref src/stone/stone.ts — references — Stone 对象实例
 * @ref src/persistence/reader.ts — references — listObjects 目录扫描
 */

import { join } from "node:path";
import { Stone } from "../stone/index.js";
import { listObjects } from "../persistence/index.js";
import type { DirectoryEntry } from "../types/index.js";

/** 对象注册表 */
export class Registry {
  /** Stone 根目录 */
  private readonly _stonesDir: string;
  /** 已加载的 Stone 缓存 */
  private _stones: Map<string, Stone> = new Map();

  constructor(stonesDir: string) {
    this._stonesDir = stonesDir;
  }

  /**
   * 扫描并加载所有对象
   */
  loadAll(): void {
    this._stones.clear();
    const names = listObjects(this._stonesDir);
    for (const name of names) {
      const dir = join(this._stonesDir, name);
      const stone = Stone.load(dir);
      if (stone) {
        this._stones.set(name, stone);
      }
    }
  }

  /**
   * 获取指定对象
   */
  get(name: string): Stone | undefined {
    return this._stones.get(name);
  }

  /**
   * 注册一个新对象
   */
  register(stone: Stone): void {
    this._stones.set(stone.name, stone);
  }

  /**
   * 获取所有对象名称
   */
  names(): string[] {
    return Array.from(this._stones.keys());
  }

  /**
   * 获取所有 Stone 实例
   */
  all(): Stone[] {
    return Array.from(this._stones.values());
  }

  /**
   * 构建通讯录（Directory）
   *
   * 每个对象的 talkable 信息组成的列表。
   */
  buildDirectory(): DirectoryEntry[] {
    return this.all().map((stone) => ({
      name: stone.name,
      whoAmI: stone.talkable.whoAmI,
      functions: [...stone.talkable.functions],
    }));
  }

  /** Stone 根目录 */
  get stonesDir(): string {
    return this._stonesDir;
  }
}
