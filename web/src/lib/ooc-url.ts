/**
 * ooc:// URL 解析工具
 *
 * 支持格式：
 * - ooc://object/{name} 或 ooc://stone/{name} — 引用对象
 * - ooc://file/objects/{name}/files/{path} 或 ooc://file/stones/{name}/files/{path} — 引用对象的 files 文件
 * - ooc://view/{相对路径} — 引用对象 View（路径相对于 World 根目录）
 *   - stones 级：`ooc://view/stones/{name}/views/{viewName}/`
 *   - flow 级：  `ooc://view/flows/{sid}/objects/{name}/views/{viewName}/`
 *   - 尾部斜杠代表整个 view 目录（默认指向 frontend.tsx）
 *
 * @ref docs/superpowers/specs/2026-04-21-trait-namespace-views-and-http-methods-design.md#4.8
 */

export type OocUrl =
  | { type: "object"; name: string }
  | { type: "file"; objectName: string; filename: string }
  | { type: "view"; path: string };

/** 解析 ooc:// URL，无法识别返回 null */
export function parseOocUrl(url: string): OocUrl | null {
  const objectMatch = url.match(/^ooc:\/\/(?:object|stone)\/([^/]+)$/);
  if (objectMatch) {
    return { type: "object", name: objectMatch[1]! };
  }

  const fileMatch = url.match(/^ooc:\/\/file\/(?:objects|stones)\/([^/]+)\/(?:files|shared)\/(.+)$/);
  if (fileMatch) {
    return { type: "file", objectName: fileMatch[1]!, filename: decodeURIComponent(fileMatch[2]!) };
  }

  const viewMatch = url.match(/^ooc:\/\/view\/(.+)$/);
  if (viewMatch) {
    return { type: "view", path: decodeURIComponent(viewMatch[1]!) };
  }

  return null;
}

/** 判断是否为 ooc:// URL */
export function isOocUrl(url: string): boolean {
  return url.startsWith("ooc://");
}
