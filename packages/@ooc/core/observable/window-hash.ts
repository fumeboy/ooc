/**
 * Window content hash + snapshot helpers — debug-only.
 *
 * 不变量:
 *   - contentHash **不进** thread.json，只在 loop_NNNN.meta.json 的 windowsSnapshot 里
 *   - 算法 type-agnostic（统一 JSON hash），不为每个 window type 注册 hashContent
 *   - stripVolatile 与 src/persistable/thread-json.ts:stripVolatileForPersist 单 window 段保持一致：
 *     剥 compressLevel === 0/undefined
 *   - hash 稳定性靠 stableStringify **递归**排序 key 保证；字段插入顺序不影响 hash
 *     （Wave 4 后业务字段在 inst.data、投影态在 inst.win，必须递归进嵌套层才保 content-sensitivity）
 *   - fileDiff 字段只对 file_window 计算；previousContent 由 finishLlmLoop 读上一 loop meta 拿到
 *   - fileDiff 不进 thread.json（debug 视角派生数据），只落 loop_NNNN.meta.json
 */

import { readFile } from "node:fs/promises";

import type { FileData } from "@ooc/core/_shared/types/context-window.js";
import type { OocObjectInstance } from "@ooc/core/runtime/ooc-class";
import { isFileClass } from "@ooc/core/_shared/types/constants.js";

/**
 * file_window 的 diff 数据；用于前端 CodeMirror Merge 双侧渲染。
 *
 * 字段语义：
 * - previousContent: 上一 loop 该 file 的内容（added 时为 ""；二进制 / 过大时也为 ""）
 * - currentContent:  当前 loop 该 file 的内容（removed 时为 ""；二进制 / 过大时也为 ""）
 * - path:            file_window.data.path（绝对或相对工作目录）
 * - isBinary:        true → 文件含 \0 byte，按二进制处理，两侧 content 都为 ""
 * - tooLarge:        true → 文件 > 200KB，按过大处理，两侧 content 都为 ""
 *
 * isBinary / tooLarge 互斥优先级：tooLarge 先判（避免 read 200MB 的二进制文件先扫 \0）。
 * 实际实现里 readFile 拿 string，size 判定走 length（char count）；utf8 字节大致 ≈ length，
 * 200KB 阈值已留足缓冲，不需要精确字节数。
 */
export type FileDiffData = {
  previousContent: string;
  currentContent: string;
  path: string;
  isBinary?: boolean;
  tooLarge?: boolean;
};

/** 200KB 阈值；超过则 tooLarge=true，不再嵌正文。 */
const FILE_DIFF_MAX_BYTES = 200 * 1024;

/**
 * 剥离 in-process volatile 字段后的 window snapshot；用于 hash 计算。
 *
 * 规则（与 stripVolatileForPersist 同款，单 window 范围）：
 * - 删 compressLevel === 0 或 undefined（默认值不参与 hash，避免与历史 window 漂移）
 * - 其余字段（含 sharing / windowKnowledgePaths / status / type-specific 字段）原样保留
 */
export function stripVolatileWindow(window: OocObjectInstance): Record<string, unknown> {
  // shallow clone 后剥字段；保证调用方传入对象不被改动（immutability）
  const rest: Record<string, unknown> = { ...(window as unknown as Record<string, unknown>) };
  // Wave 4：compressLevel 投影态落 inst.win.compressLevel；默认值（undefined/0）不参与 hash。
  const win = rest.win as { compressLevel?: number } | undefined;
  if (win && !win.compressLevel) {
    rest.win = { ...win };
    delete (rest.win as Record<string, unknown>).compressLevel;
  }
  return rest;
}

/**
 * 确定性 JSON 序列化：**递归**按 key 排序，使字段插入顺序不影响输出。
 *
 * 取代旧的 `JSON.stringify(obj, sortedKeys)`——后者的第 2 参数 key 白名单只列**顶层** key，
 * 会把所有层级里不在白名单的 key 一并过滤掉。Wave 4 后业务字段下沉 `inst.data`、投影态下沉
 * `inst.win`，这些嵌套 key 全被过滤 → data/win 序列化成 `{}`、hash 丧失 content-sensitivity。
 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const body = Object.keys(obj)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
    .join(",");
  return `{${body}}`;
}

/**
 * 计算 ContextWindow 的 content hash。
 *
 * - type-agnostic：不依赖 window type；统一对剥 volatile 后的对象做确定性序列化
 * - 用 Bun.hash（64-bit）+ toString(36) 编码（短）
 * - stableStringify 递归排序 key，保证字段序稳定且嵌套 data/win 全参与 hash
 *
 * 同 content（剥 volatile 后）→ 同 hash；
 * 不同 content → 不同 hash（高概率；hash 冲突非安全需求）。
 */
export function computeWindowContentHash(window: OocObjectInstance): string {
  const stripped = stripVolatileWindow(window);
  return Bun.hash(stableStringify(stripped)).toString(36);
}

/**
 * 单条 windowsSnapshot entry（落 loop_NNNN.meta.json）。
 *
 * 字段语义：
 * - id / type：等同源 window
 * - contentHash：computeWindowContentHash 结果
 * - parentWindowId / status / compressLevel：optional，便于前端不再 fetch 完整 window 也能渲染基本 row
 * - fileDiff：仅 file_window 填；含 path + previousContent + currentContent（hybrid 数据策略 backend 半）
 */
export type WindowSnapshotEntry = {
  id: string;
  class: string;
  contentHash: string;
  parentWindowId?: string;
  status?: string;
  compressLevel?: 0 | 1 | 2;
  fileDiff?: FileDiffData;
};

/**
 * 对 file_window 计算 fileDiff：
 * - currentContent 从 fs.readFile(window.data.path) 读（FileWindow 本身不持有 content；与 renderFileWindow 同款）
 * - previousContent 从 prev snapshot 同 id entry 的 fileDiff.currentContent 拿（首次出现 → ""）
 * - 二进制（含 \0）或过大（>200KB）时两侧 content 都设 ""，isBinary / tooLarge 字段标记
 * - 读失败（文件不存在 / 权限）→ console.warn + currentContent="" 退化，不抛错
 *
 * 注意：previousContent 只信任 prev snapshot 的记录，不再回读 fs（避免拿到当前磁盘内容而非
 * 上一 loop 时刻的内容；时间机器的核心就是 prev = "上一 loop 那一刻"）。
 */
async function computeFileDiff(
  w: OocObjectInstance<FileData>,
  previousSnapshot: WindowSnapshotEntry[] | undefined,
): Promise<FileDiffData> {
  const path = w.data.path;
  const previousContent =
    previousSnapshot?.find((s) => s.id === w.id)?.fileDiff?.currentContent ?? "";

  let currentContent = "";
  let isBinary = false;
  let tooLarge = false;

  try {
    const raw = await readFile(path, "utf8");
    if (raw.length > FILE_DIFF_MAX_BYTES) {
      tooLarge = true;
    } else if (raw.includes("\0")) {
      isBinary = true;
    } else {
      currentContent = raw;
    }
  } catch (err) {
    // silent-swallow ban: read 失败必 warn，不抛
    const msg = err instanceof Error ? err.message : String(err);
    // eslint-disable-next-line no-console
    console.warn(`[fileDiff] failed to read ${path}: ${msg}`);
  }

  const blocked = tooLarge || isBinary;
  const result: FileDiffData = {
    previousContent: blocked ? "" : previousContent,
    currentContent: blocked ? "" : currentContent,
    path,
  };
  if (isBinary) result.isBinary = true;
  if (tooLarge) result.tooLarge = true;
  return result;
}

/**
 * 给一组 ContextWindow 算 snapshot 数组。
 *
 * 输出顺序与输入顺序一致（前端按数组顺序渲染 diff row）。
 *
 * @param windows           当前 loop 的 contextWindows
 * @param previousSnapshot  上一 loop 的 windowsSnapshot（由 finishLlmLoop 读 loop_NNNN-1.meta.json
 *                          得到；undefined 表示首轮 / 无 prev）。仅用于派生 file_window 的
 *                          previousContent。
 */
export async function buildWindowsSnapshot(
  windows: OocObjectInstance[],
  previousSnapshot?: WindowSnapshotEntry[],
): Promise<WindowSnapshotEntry[]> {
  const out: WindowSnapshotEntry[] = [];
  for (const w of windows) {
    const entry: WindowSnapshotEntry = {
      id: w.id,
      class: w.class,
      contentHash: computeWindowContentHash(w),
    };
    if (w.parentObjectId) entry.parentWindowId = w.parentObjectId;
    if (w.status) entry.status = w.status;
    const compressLevel = (w.win as { compressLevel?: 0 | 1 | 2 } | undefined)?.compressLevel;
    if (compressLevel !== undefined && compressLevel !== 0) {
      entry.compressLevel = compressLevel;
    }
    // file 实例的 stored class 是注册 id（FILE_CLASS_ID）；裸名 "file" 只是 readable 投影 class，
    // 真实管道里的 contextWindows 永远持注册 id，旧的 `w.class === "file"` 判定恒不命中 → fileDiff dead。
    if (isFileClass(w.class)) {
      entry.fileDiff = await computeFileDiff(w as unknown as OocObjectInstance<FileData>, previousSnapshot);
    }
    out.push(entry);
  }
  return out;
}
