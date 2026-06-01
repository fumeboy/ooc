import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { packageDir, stoneDir, type StoneObjectRef } from "./common";

/** stone 的身份说明文件 self.md 的绝对路径。 */
export function selfFile(ref: StoneObjectRef): string {
  return join(stoneDir(ref), "self.md");
}

/** 读取 self.md，不存在返回 undefined。 */
export async function readSelf(ref: StoneObjectRef): Promise<string | undefined> {
  try {
    return await readFile(selfFile(ref), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

/** 写入 self.md，覆盖。 */
export async function writeSelf(ref: StoneObjectRef, text: string): Promise<void> {
  await writeFile(selfFile(ref), text, "utf8");
}
