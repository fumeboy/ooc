/**
 * Prototype 链解析: 给定 ObjectRecord 与 key，沿 self.md `extends:` 链向上查找。
 *
 * 详见 spec §4.2。
 */

import type { ObjectRecord } from "../persistable/object-record";
import { resolveExtendsURI } from "../persistable/uri";
import type { ObjectRegistry } from "./registry";

/**
 * 解析 prototype 链：从 startUri 出发，沿 extends 字段向上，直到链终点（extends 为空或显式 null）。
 *
 * @returns 链上各 ObjectRecord 的 URI 列表，第一个是 startUri 自身；最后一个是链终点（通常 root）。
 * @throws 当出现环 / 无效 extends URI / 链上某节点不在 registry 中时抛错（boundary 严格）
 */
export function resolveChain(
    registry: ObjectRegistry,
    startUri: string,
): string[] {
    const visited = new Set<string>();
    const chain: string[] = [];
    let currentUri: string | undefined = startUri;
    while (currentUri) {
        if (visited.has(currentUri)) {
            throw new Error(
                `Cycle detected in extends chain: ${chain.join(" -> ")} -> ${currentUri}`,
            );
        }
        visited.add(currentUri);
        chain.push(currentUri);
        const record: ObjectRecord | undefined = registry.get(currentUri);
        if (!record) {
            throw new Error(
                `Object not found in registry while resolving chain: ${currentUri}`,
            );
        }
        const next = record.self.extends;
        if (!next) {
            break;
        }
        currentUri = resolveExtendsURI(next);
    }
    return chain;
}

/**
 * 在 prototype 链上找到第一个满足 predicate 的 ObjectRecord，返回 URI（链外没找到返回 undefined）。
 *
 * 用于 method / client fallback 解析: predicate = "该 record 拥有这个 method"。
 */
export function findInChain(
    registry: ObjectRegistry,
    startUri: string,
    predicate: (record: ObjectRecord) => boolean,
): string | undefined {
    const chain = resolveChain(registry, startUri);
    for (const uri of chain) {
        const record = registry.get(uri);
        if (record && predicate(record)) {
            return uri;
        }
    }
    return undefined;
}
