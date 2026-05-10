import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { serverDir } from "./stone-object";
import type { StoneObjectRef } from "./common";

/** stone 的 server/index.ts 绝对路径。 */
export function serverIndexFile(ref: StoneObjectRef): string {
  return join(serverDir(ref), "index.ts");
}

/** 读取 server/index.ts 源码，不存在返回 undefined。 */
export async function readServerSource(ref: StoneObjectRef): Promise<string | undefined> {
  try {
    return await readFile(serverIndexFile(ref), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

/** 写入 server/index.ts 源码，自动 mkdir server/ 目录。 */
export async function writeServerSource(ref: StoneObjectRef, code: string): Promise<void> {
  await mkdir(serverDir(ref), { recursive: true });
  await writeFile(serverIndexFile(ref), code, "utf8");
}
