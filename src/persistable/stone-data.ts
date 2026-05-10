import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { stoneDir, toJson, type StoneObjectRef } from "./common";

/** stone 的数据文件 data.json 的绝对路径。 */
export function dataFile(ref: StoneObjectRef): string {
  return join(stoneDir(ref), "data.json");
}

/** 读取 data.json，不存在返回 undefined。 */
export async function readData(
  ref: StoneObjectRef
): Promise<Record<string, unknown> | undefined> {
  try {
    const raw = await readFile(dataFile(ref), "utf8");
    return JSON.parse(raw) as Record<string, unknown>;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

/** 整体覆盖写 data.json。 */
export async function writeData(
  ref: StoneObjectRef,
  data: Record<string, unknown>
): Promise<void> {
  await writeFile(dataFile(ref), toJson(data), "utf8");
}

/** 顶层 spread merge：读现有 data.json（缺省 `{}`）→ spread patch → 写回。 */
export async function mergeData(
  ref: StoneObjectRef,
  patch: Record<string, unknown>
): Promise<void> {
  const existing = (await readData(ref)) ?? {};
  await writeData(ref, { ...existing, ...patch });
}
