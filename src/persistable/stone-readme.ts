import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { stoneDir, type StoneObjectRef } from "./common";

/** stone 的对外说明文件 readme.md 的绝对路径。 */
export function readmeFile(ref: StoneObjectRef): string {
  return join(stoneDir(ref), "readme.md");
}

/** 读取 readme.md，不存在返回 undefined。 */
export async function readReadme(ref: StoneObjectRef): Promise<string | undefined> {
  try {
    return await readFile(readmeFile(ref), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

/** 写入 readme.md，覆盖。 */
export async function writeReadme(ref: StoneObjectRef, text: string): Promise<void> {
  await writeFile(readmeFile(ref), text, "utf8");
}
