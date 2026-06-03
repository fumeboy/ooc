import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { serverDir, executableDir } from "./stone-object";
import type { StoneObjectRef } from "./common";

/** stone 的 server/index.ts 绝对路径。 */
/** @deprecated Use executableIndexFile instead (2026-05-28 ooc-6 Object Unification). server/ is being renamed to executable/. */
export function serverIndexFile(ref: StoneObjectRef): string {
  return join(serverDir(ref), "index.ts");
}

/**
 * stone 的 executable/index.ts 绝对路径（原 server/index.ts 重命名，2026-05-28 ooc-6）。
 * 存放 Object 的 methods 实现。
 */
export function executableIndexFile(ref: StoneObjectRef): string {
  return join(executableDir(ref), "index.ts");
}

/** 读取 server/index.ts 源码，不存在返回 undefined。 */
/** @deprecated Use readExecutableSource instead (2026-05-28 ooc-6 Object Unification). */
export async function readServerSource(ref: StoneObjectRef): Promise<string | undefined> {
  try {
    return await readFile(serverIndexFile(ref), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

/**
 * 读取 executable/index.ts 源码，不存在返回 undefined。
 * 迁移期双读：优先 executable/，fallback 到 server/。
 */
export async function readExecutableSource(ref: StoneObjectRef): Promise<string | undefined> {
  try {
    return await readFile(executableIndexFile(ref), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      // Migration fallback: try old server/ path
      try {
        return await readFile(serverIndexFile(ref), "utf8");
      } catch (e2) {
        if ((e2 as NodeJS.ErrnoException).code === "ENOENT") return undefined;
        throw e2;
      }
    }
    throw error;
  }
}

/** 写入 server/index.ts 源码，自动 mkdir server/ 目录。 */
/** @deprecated Use writeExecutableSource instead (2026-05-28 ooc-6 Object Unification). */
export async function writeServerSource(ref: StoneObjectRef, code: string): Promise<void> {
  await mkdir(serverDir(ref), { recursive: true });
  await writeFile(serverIndexFile(ref), code, "utf8");
}

/**
 * 写入 executable/index.ts 源码，自动 mkdir executable/ 目录。
 */
export async function writeExecutableSource(ref: StoneObjectRef, code: string): Promise<void> {
  await mkdir(executableDir(ref), { recursive: true });
  await writeFile(executableIndexFile(ref), code, "utf8");
}
