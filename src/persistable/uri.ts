/**
 * ooc:// URI scheme — 1:1 镜像文件系统路径。
 *
 * 形态（spec §4.3）:
 * - ooc://stones/_builtin/objects/<proto>
 * - ooc://stones/<branch>/objects/<name>
 * - ooc://stones/<branch>/objects/<name>/children/<sub>
 * - ooc://pools/objects/<name>
 * - ooc://pools/<shared>
 * - ooc://flows/<sessionId>/objects/<name>
 * - ooc://flows/<sessionId>/objects/<name>/threads/<thread_id>
 *
 * runtime 与 web 共用同一份解析器。
 */

import { join, sep } from "node:path";

const URI_PREFIX = "ooc://";

/**
 * 解析出的 URI 三段：root（stones/pools/flows）+ 第一级（branch/sessionId/etc）+ 余下路径段。
 */
export type ParsedURI = {
    layer: "stones" | "pools" | "flows";
    /** stones 下第一段是 branch；flows 下是 sessionId；pools 下是 'objects' 或 '<shared-name>' */
    head: string;
    /** 余下路径段（按 "/" 切分） */
    rest: string[];
};

export function isOocURI(value: string): boolean {
    return value.startsWith(URI_PREFIX);
}

/**
 * 解析 ooc:// URI 为结构化对象。
 *
 * @throws 当 URI 不以 ooc:// 开头或 layer 无效时抛错（boundary input 严格检查）
 */
export function parseURI(uri: string): ParsedURI {
    if (!isOocURI(uri)) {
        throw new Error(`Not an ooc:// URI: ${uri}`);
    }
    const stripped = uri.slice(URI_PREFIX.length);
    const segments = stripped.split("/").filter((s) => s.length > 0);
    if (segments.length === 0) {
        throw new Error(`URI has no path: ${uri}`);
    }
    const layer = segments[0];
    if (layer !== "stones" && layer !== "pools" && layer !== "flows") {
        throw new Error(`Unknown layer "${layer}" in URI: ${uri}`);
    }
    if (segments.length < 2) {
        throw new Error(`URI has no head segment after layer: ${uri}`);
    }
    return {
        layer,
        head: segments[1],
        rest: segments.slice(2),
    };
}

/**
 * 把 ooc:// URI 转换为相对于 world root 的文件系统路径。
 *
 * 例: ooc://stones/main/objects/foo → stones/main/objects/foo
 *
 * 不做绝对路径拼接（由调用方决定 world root）；纯字符串变换。
 */
export function uriToRelativePath(uri: string): string {
    const parsed = parseURI(uri);
    return join(parsed.layer, parsed.head, ...parsed.rest);
}

/**
 * 把相对于 world root 的文件系统路径反向构造为 ooc:// URI。
 *
 * 例: stones/main/objects/foo → ooc://stones/main/objects/foo
 *
 * 输入必须以 stones/ 或 pools/ 或 flows/ 开头；否则抛错。
 */
export function relativePathToURI(relPath: string): string {
    const normalized = relPath.split(sep).join("/");
    const segments = normalized.split("/").filter((s) => s.length > 0);
    if (segments.length === 0) {
        throw new Error(`Empty path cannot be converted to URI`);
    }
    const layer = segments[0];
    if (layer !== "stones" && layer !== "pools" && layer !== "flows") {
        throw new Error(`Path does not start with stones/pools/flows: ${relPath}`);
    }
    return `${URI_PREFIX}${segments.join("/")}`;
}

/**
 * 解析 self.md 中 extends 字段的"简写"为完整 URI。
 *
 * - "root" / "search" / "program" 等命名 → ooc://stones/_builtin/objects/<name>
 * - 已经是完整 ooc:// URI → 原样返回
 *
 * 任何其他形态（含 "/"）→ 抛错（避免歧义）
 */
export function resolveExtendsURI(extendsField: string): string {
    if (isOocURI(extendsField)) {
        return extendsField;
    }
    if (extendsField.includes("/") || extendsField.includes(":")) {
        throw new Error(`extends shorthand must be a bare name, got: ${extendsField}`);
    }
    return `${URI_PREFIX}stones/_builtin/objects/${extendsField}`;
}
