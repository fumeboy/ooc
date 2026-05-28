/**
 * Object Registry: 按 URI 索引 ObjectRecord，提供 get / set / has / delete / list。
 *
 * 详见 spec §4.1 + §4.2。
 */

import type { ObjectRecord } from "../persistable/object-record";

export class ObjectRegistry {
    private readonly map = new Map<string, ObjectRecord>();

    /**
     * 注册或覆盖一个 ObjectRecord（按 uri key）。
     */
    set(record: ObjectRecord): void {
        this.map.set(record.uri, record);
    }

    /**
     * 按 URI 查找；未注册返回 undefined。
     */
    get(uri: string): ObjectRecord | undefined {
        return this.map.get(uri);
    }

    has(uri: string): boolean {
        return this.map.has(uri);
    }

    delete(uri: string): boolean {
        return this.map.delete(uri);
    }

    /**
     * 返回所有已注册 ObjectRecord 的迭代器。
     */
    list(): ObjectRecord[] {
        return Array.from(this.map.values());
    }

    /**
     * 清空整张表（仅用于测试 / loader 重建）。
     */
    clear(): void {
        this.map.clear();
    }

    get size(): number {
        return this.map.size;
    }
}
