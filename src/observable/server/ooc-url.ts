import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { World } from "../../world/index.js";
import { errorResponse, json } from "./responses.js";

/** 解析 ooc:// URL 并返回对应数据 */
export function handleOocResolve(oocUrl: string, world: World): Response {
  const objectMatch = oocUrl.match(/^ooc:\/\/(?:object|stone)\/([^/]+)$/);
  if (objectMatch) {
    const name = objectMatch[1]!;
    const stone = world.getObject(name);
    if (!stone) return errorResponse(`对象 "${name}" 不存在`, 404);
    return json({ success: true, data: { type: "object", ...stone.toJSON() } });
  }

  const fileMatch = oocUrl.match(/^ooc:\/\/file\/(?:objects|stones)\/([^/]+)\/(?:files|shared)\/(.+)$/);
  if (fileMatch) {
    const objectName = fileMatch[1]!;
    const filename = decodeURIComponent(fileMatch[2]!);
    const stone = world.getObject(objectName);
    if (!stone) return errorResponse(`对象 "${objectName}" 不存在`, 404);
    let filePath = join(stone.dir, "files", filename);
    let baseDir = join(stone.dir, "files");
    if (!existsSync(filePath)) {
      filePath = join(stone.dir, filename);
      baseDir = stone.dir;
    }
    if (!existsSync(filePath)) return errorResponse(`文件 "${filename}" 不存在`, 404);
    if (!filePath.startsWith(baseDir)) return errorResponse("非法路径", 403);
    const content = readFileSync(filePath, "utf-8");
    return json({ success: true, data: { type: "file", objectName, filename, content } });
  }

  const viewMatch = oocUrl.match(/^ooc:\/\/view\/(.+)$/);
  if (viewMatch) {
    const relPath = decodeURIComponent(viewMatch[1]!);
    const resolvedRel = relPath.endsWith("/") ? relPath + "frontend.tsx" : relPath;
    const filePath = join(world.rootDir, resolvedRel);
    if (!filePath.startsWith(world.rootDir)) return errorResponse("非法路径", 403);
    if (!existsSync(filePath)) return errorResponse(`View 文件 "${resolvedRel}" 不存在`, 404);
    const content = readFileSync(filePath, "utf-8");
    return json({ success: true, data: { type: "view", path: resolvedRel, content } });
  }

  return errorResponse(`无法解析 ooc:// URL: ${oocUrl}`);
}
