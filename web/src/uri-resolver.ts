/**
 * URI 解析器 — visible 层前端路由入口。
 *
 * ooc:// URI 与 SPA route 1:1 镜像（spec §5.1）。
 * 复用 src/persistable/uri.ts 的解析逻辑，不依赖 React/DOM。
 */

/** 解析结果：layer + 对象名 + 可选 sessionId（flows 层专有）。 */
export type ResolvedUri = {
    /** 持久层 */
    layer: "stones" | "pools" | "flows";
    /** 对象名（stones: <branch>/objects/<name>；pools: objects/<name>；flows: <sessionId>/objects/<name>） */
    name: string;
    /** flows 层专有：session id */
    sessionId?: string;
};

const URI_PREFIX = "ooc://";

/**
 * 解析 ooc:// URI 为前端路由所需的结构化描述。
 *
 * 示例：
 *   ooc://stones/main/objects/foo  → { layer: "stones", name: "foo" }
 *   ooc://flows/s1/objects/bar     → { layer: "flows", name: "bar", sessionId: "s1" }
 *   ooc://pools/objects/baz        → { layer: "pools", name: "baz" }
 *
 * @throws 当 URI 格式无效时抛错（boundary strict）
 */
export function resolveUri(uri: string): ResolvedUri {
    if (!uri.startsWith(URI_PREFIX)) {
        throw new Error(`Not an ooc:// URI: ${uri}`);
    }
    const stripped = uri.slice(URI_PREFIX.length);
    const segments = stripped.split("/").filter((s) => s.length > 0);

    if (segments.length < 2) {
        throw new Error(`URI too short to resolve: ${uri}`);
    }

    const layer = segments[0];
    if (layer !== "stones" && layer !== "pools" && layer !== "flows") {
        throw new Error(`Unknown layer "${layer}" in URI: ${uri}`);
    }

    switch (layer) {
        case "stones": {
            // ooc://stones/<branch>/objects/<name>[/...]
            const objectsIdx = segments.indexOf("objects");
            if (objectsIdx < 0 || objectsIdx + 1 >= segments.length) {
                throw new Error(`stones URI missing objects/<name>: ${uri}`);
            }
            const name = segments.slice(objectsIdx + 1).join("/");
            return { layer, name };
        }
        case "pools": {
            // ooc://pools/objects/<name>[/...] or ooc://pools/<shared>[/...]
            if (segments[1] === "objects" && segments.length >= 3) {
                const name = segments.slice(2).join("/");
                return { layer, name };
            }
            // shared pool
            const name = segments.slice(1).join("/");
            return { layer, name };
        }
        case "flows": {
            // ooc://flows/<sessionId>/objects/<name>[/...]
            const sessionId = segments[1];
            const objectsIdx = segments.indexOf("objects");
            if (objectsIdx < 0 || objectsIdx + 1 >= segments.length) {
                throw new Error(`flows URI missing objects/<name>: ${uri}`);
            }
            const name = segments.slice(objectsIdx + 1).join("/");
            return { layer, name, sessionId };
        }
    }
}

/**
 * 将 ooc:// URI 转换为 SPA route path（去掉协议前缀）。
 *
 * 例: ooc://stones/main/objects/foo → /stones/main/objects/foo
 */
export function uriToRoutePath(uri: string): string {
    if (!uri.startsWith(URI_PREFIX)) {
        throw new Error(`Not an ooc:// URI: ${uri}`);
    }
    return "/" + uri.slice(URI_PREFIX.length);
}
