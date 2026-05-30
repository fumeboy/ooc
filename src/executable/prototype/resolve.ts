// src/executable/prototype/resolve.ts
import type { ObjectRecord } from "./object-record";
import type { ObjectRegistry } from "./registry";

/** probe：给定一个 record，判断它是否提供所求；提供则返回 payload，否则 undefined。 */
export type Probe<T> = (record: ObjectRecord) => T | undefined;

/**
 * 沿 extends 链 resolve（D5）：own 先 probe → 命中即返回；miss 则沿 extends 向上，
 * 直到终点（extends=null）仍 miss 返回 undefined。
 *
 * 方法 / visible / readable 三者共用本 walk，只是传不同 probe。
 *
 * - startId 不在 registry → 抛错（fail-loud）。
 * - visited set 二次防环（registry build 已校验，此处 defense-in-depth）。
 */
export function resolveAlongChain<T>(
  registry: ObjectRegistry,
  startId: string,
  probe: Probe<T>,
): { record: ObjectRecord; value: T } | undefined {
  if (!registry.has(startId)) {
    throw new Error(`resolveAlongChain: startId「${startId}」不在 registry 中（未注册）`);
  }
  const visited = new Set<string>();
  let curId: string | null = startId;
  while (curId !== null) {
    if (visited.has(curId)) {
      throw new Error(`resolveAlongChain: extends 链中遇环，重复节点「${curId}」`);
    }
    visited.add(curId);
    const record = registry.get(curId);
    if (!record) {
      // 悬空——registry build 应已拒载；此处 fail-loud
      throw new Error(`resolveAlongChain: 链节点「${curId}」不在 registry（悬空）`);
    }
    const value = probe(record);
    if (value !== undefined) return { record, value };
    curId = record.extends;
  }
  return undefined;
}
