import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { executableDir, stoneDir } from "./stone-object";
import type { StoneObjectRef } from "./common";

/**
 * stone 的 executable/index.ts 绝对路径（原 server/index.ts 重命名）。
 * 存放 Object 的 methods 实现。
 */
export function executableIndexFile(ref: StoneObjectRef): string {
  return join(executableDir(ref), "index.ts");
}

/**
 * 读取 executable/index.ts 源码，不存在返回 undefined。
 * 迁移期双读：优先 executable/，fallback 到 server/（legacy path）。
 */
export async function readExecutableSource(ref: StoneObjectRef): Promise<string | undefined> {
  try {
    return await readFile(executableIndexFile(ref), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      // Migration fallback: try old server/ path
      try {
        return await readFile(join(stoneDir(ref), "server", "index.ts"), "utf8");
      } catch (e2) {
        if ((e2 as NodeJS.ErrnoException).code === "ENOENT") return undefined;
        throw e2;
      }
    }
    throw error;
  }
}

/**
 * 写入 executable/index.ts 源码，自动 mkdir executable/ 目录。
 */
export async function writeExecutableSource(ref: StoneObjectRef, code: string): Promise<void> {
  await mkdir(executableDir(ref), { recursive: true });
  await writeFile(executableIndexFile(ref), code, "utf8");
}
