/**
 * Flow-layer data.json IO —— 承载 ProgramSelf.getData / setData 的读写
 * （2026-05-23 起从 stone 层迁到 flow 层；详见 meta/object.doc.ts persistable.flow.session_data）。
 *
 * 路径形态：`{baseDir}/flows/{sessionId}/{objectId}/data.json`
 *
 * 语义变化（升级时注意）：
 * - 不再是跨 session 长期数据，而是 session 级临时数据。
 * - 顶层 spread merge 形态（与历史 stone-data.ts 一致）保留，只是落点改了。
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { objectDir, toJson, type FlowObjectRef } from "./common";
import { enqueueSessionWrite } from "../runtime/serial-queue.js";

/** flow object 的数据文件 `data.json` 的绝对路径。 */
export function flowDataFile(ref: FlowObjectRef): string {
  return join(objectDir(ref), "data.json");
}

/**
 * 读取 flow object 的 data.json：
 * - 文件不存在（ENOENT）返回空对象 `{}`（与 ProgramSelf.getData 行为一致）。
 * - JSON 解析失败抛带 path 与 cause 的清晰错误，便于排查。
 * - 其它 IO 错误向上抛。
 */
export async function readData(ref: FlowObjectRef): Promise<Record<string, unknown>> {
  const file = flowDataFile(ref);
  let raw: string;
  try {
    raw = await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
  try {
    const parsed = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error(`flow data.json 必须是顶层 JSON object，实际类型 ${typeof parsed}`);
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    throw new Error(
      `解析 flow data.json 失败 (${file}): ${(error as Error).message}`,
      { cause: error },
    );
  }
}

/**
 * 写入 flow object 的 data.json：
 * - 自动 mkdir -p 父目录（首次 setData 时 flow object 目录可能尚未创建）。
 * - 整体覆盖语义。
 * - 通过 enqueueSessionWrite('flow-data:'+...) 串行化写，避免并发踩坏。
 */
export async function writeData(
  ref: FlowObjectRef,
  data: Record<string, unknown>,
): Promise<void> {
  const file = flowDataFile(ref);
  const key = `flow-data:${ref.baseDir}:${ref.sessionId}:${ref.objectId}`;
  await enqueueSessionWrite(key, async () => {
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, toJson(data), "utf8");
  });
}

/**
 * 顶层 spread merge：读现有 data.json（缺省 `{}`）→ spread patch → 写回。
 *
 * 整个 read-modify-write 串行化（同一 flow object 级队列）；同 key 并发调用按入队顺序
 * 串行，避免 lost-update。
 */
export async function mergeData(
  ref: FlowObjectRef,
  patch: Record<string, unknown>,
): Promise<void> {
  const file = flowDataFile(ref);
  const key = `flow-data:${ref.baseDir}:${ref.sessionId}:${ref.objectId}`;
  await enqueueSessionWrite(key, async () => {
    let existing: Record<string, unknown> = {};
    try {
      const raw = await readFile(file, "utf8");
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        existing = parsed as Record<string, unknown>;
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, toJson({ ...existing, ...patch }), "utf8");
  });
}
