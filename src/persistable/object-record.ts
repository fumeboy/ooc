/**
 * ObjectRecord: OOC Object 在 runtime 的统一表示，承载三层物理路径 (stone/pool/flow)
 * 与从 self.md frontmatter 解析出的元数据。
 *
 * 详见 spec §4.2。
 */

export type ObjectKind = "builtin" | "persistent" | "ephemeral";

/**
 * Object 在三层持久层中的实际磁盘路径（可能仅部分存在）。
 * - stone: 身份与设计；persistent / builtin 必有；ephemeral 没有
 * - pool: 累积产物；persistent 通常有；builtin / ephemeral 没有
 * - flow: 当前活跃 session 的运行时过程；persistent 在 active session 中有；ephemeral 是它的全部
 */
export type ObjectPaths = {
    stone?: string;
    pool?: string;
    flow?: string;
};

/**
 * self.md 的 frontmatter 解析结果。除 extends 外的字段允许任意 key-value。
 */
export type SelfFrontmatter = {
    extends?: string;
    [key: string]: unknown;
};

/**
 * Object 在 registry 中的完整记录。
 *
 * 由 loader 从磁盘 scan 时构造；prototype 链解析、URI 解析、method dispatch 都基于此。
 */
export type ObjectRecord = {
    /** ooc:// 绝对 URI */
    uri: string;
    /** 三层物理路径 */
    paths: ObjectPaths;
    /** 类别：决定加载策略与生命期 */
    kind: ObjectKind;
    /** self.md frontmatter */
    self: SelfFrontmatter;
};

/**
 * 判断 Object 是否为 builtin prototype（位置即类别）。
 */
export function isBuiltin(record: ObjectRecord): boolean {
    return record.kind === "builtin";
}

/**
 * 判断 Object 是否为 persistent（同时占 stone + pool）。
 */
export function isPersistent(record: ObjectRecord): boolean {
    return record.kind === "persistent";
}

/**
 * 判断 Object 是否为 ephemeral（仅在 flow 内）。
 */
export function isEphemeral(record: ObjectRecord): boolean {
    return record.kind === "ephemeral";
}
