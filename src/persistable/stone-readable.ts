import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { stoneDir, type StoneObjectRef } from "./common";

/** stone 的对外说明文件 readable.md 的绝对路径。 */
export function readableFile(ref: StoneObjectRef): string {
  return join(stoneDir(ref), "readable.md");
}

/** 读取 readable.md，不存在返回 undefined。 */
export async function readReadable(ref: StoneObjectRef): Promise<string | undefined> {
  try {
    return await readFile(readableFile(ref), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

/** 写入 readable.md，覆盖。 */
export async function writeReadable(ref: StoneObjectRef, text: string): Promise<void> {
  await writeFile(readableFile(ref), text, "utf8");
}
