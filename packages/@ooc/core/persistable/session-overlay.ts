/**
 * Flow session overlay —— stone identity 文件的会话内试验层（决策 A：plain 目录）。
 *
 * 设计：docs/2026-06-05-stone-flow-overlay-versioning-design.md §3。
 *
 * 模型：
 * - **canonical stone**（main 分支 worktree，`stones/main/objects/<id>/`）是 Object
 *   已提交的权威自我，唯一读源。
 * - **flow session overlay**（`flows/<sid>/<id>/overlay/<relWithinObject>`）是普通业务
 *   session（非 super、非控制面）对 self 文件（self.md / readable.* / executable/** /
 *   visible/** / knowledge/**）的试验性改动：session 私有、即时可见、不污染 canonical。
 * - 读 stone identity 时 overlay shadow main：overlay 存在则用 overlay，否则透传 main。
 * - 未经 super-flow evolve_self 合入的 overlay 改动不进 canonical（试验不污染身份）。
 *
 * 本模块只负责**路径计算 + plain read/write**；写重定向的"该不该走 overlay"判定、
 * 合入逻辑分别在 file builtin（P2 写路径）与 evolve_self（P3）里。
 */

import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import { nestedObjectPath } from "../_shared/types/thread.js";
import { isSuperSessionId } from "../_shared/types/constants.js";

/** overlay 子目录名（在 flow object 目录下）。 */
export const OVERLAY_SUBDIR = "overlay";

/** overlay 根目录（某 session 下某 object 的 overlay/）。 */
export function overlayRootDir(baseDir: string, sessionId: string, objectId: string): string {
  return join(baseDir, "flows", sessionId, ...nestedObjectPath(objectId), OVERLAY_SUBDIR);
}

/**
 * 列出某 session overlay 下所有文件的 relWithinObject 路径（相对 object stone 根，
 * 用 "/" 分隔，递归）。overlay 不存在返回空数组。
 *
 * 供 super-flow evolve_self 枚举「本 session 改了哪些 stone 文件」。
 */
export async function listOverlayFiles(
  baseDir: string,
  sessionId: string,
  objectId: string,
): Promise<string[]> {
  const root = overlayRootDir(baseDir, sessionId, objectId);
  const out: string[] = [];
  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    for (const e of entries) {
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        await walk(full);
      } else if (e.isFile()) {
        out.push(relative(root, full).split(sep).join("/"));
      }
    }
  }
  await walk(root);
  return out.sort();
}

/**
 * 计算某个 stone identity 文件在 session overlay 中的绝对路径。
 *
 * @param baseDir       OOC world 根
 * @param sessionId     当前 flow session id
 * @param objectId      stone object id（逻辑 id；嵌套 segment 经 children/ 翻译）
 * @param relWithinObject 相对 object stone 根的路径（如 `self.md` / `executable/index.ts` /
 *                        `visible/index.tsx` / `knowledge/x.md`）
 *
 * 落点：`flows/<sid>/<nestedObjectPath(objectId)>/overlay/<relWithinObject>`。
 * 与 objectDir 对齐（同一 flow object 目录下挂 overlay/ 子目录）。
 */
export function overlayStoneFilePath(
  baseDir: string,
  sessionId: string,
  objectId: string,
  relWithinObject: string,
): string {
  return join(
    baseDir,
    "flows",
    sessionId,
    ...nestedObjectPath(objectId),
    OVERLAY_SUBDIR,
    ...relWithinObject.split("/").filter(Boolean),
  );
}

/**
 * 判断 sessionId 是否是「会走 overlay」的普通业务 flow session。
 *
 * overlay 仅适用于普通业务 session：
 * - super flow（sessionId==="super"）操作 canonical 本身，不应用 overlay。
 * - 控制面 HTTP / 内存模式（无 sessionId）也不走 overlay。
 *
 * @returns true 表示该 session 的 self 文件写/读应走 overlay；false 表示直透 canonical。
 */
export function sessionUsesOverlay(sessionId: string | undefined): boolean {
  if (!sessionId) return false;
  if (isSuperSessionId(sessionId)) return false;
  return true;
}

/**
 * 把 classifyPackagesPath 给出的 `relInPackages`（相对 `stones/main/objects/` 根，
 * 含 owner 段 + children/ marker，如 `a/children/b/self.md`）转成相对 object stone 根的
 * `relWithinObject`（如 `self.md`），通过剥掉 owner 的 nestedObjectPath 前缀。
 *
 * @returns relWithinObject；若 relInPackages 不以 owner 物理前缀起头返回 undefined（防御）。
 */
export function relWithinObjectFromPackages(
  ownerObjectId: string,
  relInPackages: string,
): string | undefined {
  const prefixSegs = nestedObjectPath(ownerObjectId);
  const segs = relInPackages.split("/").filter(Boolean);
  if (segs.length < prefixSegs.length) return undefined;
  for (let i = 0; i < prefixSegs.length; i += 1) {
    if (segs[i] !== prefixSegs[i]) return undefined;
  }
  return segs.slice(prefixSegs.length).join("/");
}

/**
 * 读 overlay 中的某个 stone 文件；不存在返回 undefined。
 * 纯 plain read，不 fallback 到 canonical（caller 负责 fallback 编排）。
 */
export async function readOverlayFile(
  baseDir: string,
  sessionId: string,
  objectId: string,
  relWithinObject: string,
): Promise<string | undefined> {
  try {
    return await readFile(
      overlayStoneFilePath(baseDir, sessionId, objectId, relWithinObject),
      "utf8",
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

/**
 * 写 overlay 中的某个 stone 文件（plain write，自动 mkdir 父目录）。
 * **不走 versionedStoneWrite / 不 commit main**——overlay 是 session 私有试验层。
 */
export async function writeOverlayFile(
  baseDir: string,
  sessionId: string,
  objectId: string,
  relWithinObject: string,
  content: string,
): Promise<void> {
  const target = overlayStoneFilePath(baseDir, sessionId, objectId, relWithinObject);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, content, "utf8");
}

/**
 * 读某个 stone 文件，overlay shadow main：
 * 1. 若当前 session 是普通业务 session 且 overlay 存在 → 返回 overlay 内容。
 * 2. 否则调 `readCanonical()` 读 canonical main worktree。
 *
 * caller 提供 `readCanonical` 闭包（已有的 readSelf / readReadable / readExecutableSource
 * 等），避免本模块反向依赖各 stone-* 文件。
 */
export async function readStoneFileWithOverlay(
  baseDir: string | undefined,
  sessionId: string | undefined,
  objectId: string | undefined,
  relWithinObject: string,
  readCanonical: () => Promise<string | undefined>,
): Promise<string | undefined> {
  if (baseDir && objectId && sessionUsesOverlay(sessionId)) {
    const overlaid = await readOverlayFile(baseDir, sessionId!, objectId, relWithinObject);
    if (overlaid !== undefined) return overlaid;
  }
  return readCanonical();
}
