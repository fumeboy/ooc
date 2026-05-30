// src/executable/prototype/registry.ts
import type { ObjectRecord } from "./object-record";

/** 不可变 registry 快照：按 canonical id 索引 ObjectRecord，并已通过拓扑校验。 */
export interface ObjectRegistry {
  get(id: string): ObjectRecord | undefined;
  has(id: string): boolean;
  ids(): string[];
}

/**
 * 由一组 ObjectRecord 构建 registry，build 时做三重 fail-loud 校验（D4）：
 * 1. 重复 id 拒载
 * 2. 悬空 extends（父不存在）拒载
 * 3. 环（拓扑校验）拒载
 *
 * records 如何从磁盘发现与本函数解耦（L3 提供 scanner）。
 */
export function buildObjectRegistry(records: ObjectRecord[]): ObjectRegistry {
  const map = new Map<string, ObjectRecord>();
  for (const r of records) {
    if (map.has(r.id)) {
      throw new Error(`buildObjectRegistry: duplicate object id「${r.id}」（重复 id 拒载）`);
    }
    map.set(r.id, Object.freeze({ ...r, has: Object.freeze({ ...r.has }) }));
  }

  // 悬空校验
  for (const r of map.values()) {
    if (r.extends !== null && !map.has(r.extends)) {
      throw new Error(
        `buildObjectRegistry: dangling extends「${r.extends}」（${r.id} 的父原型不存在；拒载）`,
      );
    }
  }

  // 环检测：沿 extends 单父链 walk，遇重复即环（单父 → 用 path set 即可）
  for (const start of map.keys()) {
    const seen = new Set<string>();
    let cur: string | null = start;
    while (cur !== null) {
      if (seen.has(cur)) {
        throw new Error(
          `buildObjectRegistry: extends 链中检测到环（cycle），起于「${start}」，重复节点「${cur}」（拒载）`,
        );
      }
      seen.add(cur);
      cur = map.get(cur)?.extends ?? null;
    }
  }

  return {
    get: (id) => map.get(id),
    has: (id) => map.has(id),
    ids: () => Array.from(map.keys()),
  };
}
