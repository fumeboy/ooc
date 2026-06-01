import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { stoneDir, type StoneObjectRef } from "./common";

/** stone 的对外说明文件 readme.md 的绝对路径。 */
/** @deprecated Use readableFile instead (2026-05-28 ooc-6 Object Unification). readme.md is being renamed to readable.md. */
export function readmeFile(ref: StoneObjectRef): string {
  return join(stoneDir(ref), "readme.md");
}

/**
 * stone 的 readable.md 绝对路径（原 readme.md 重命名，2026-05-28 ooc-6）。
 * 静态展示文本，供外部 Object 或 user 理解该 Object。
 */
export function readableFile(ref: StoneObjectRef): string {
  return join(stoneDir(ref), "readable.md");
}

/**
 * stone 的 readable.ts 绝对路径（2026-05-28 ooc-6 新增）。
 * 动态上下文渲染函数，控制 Object 如何在 context 中以 XML 形式展示给 LLM。
 */
export function readableTsFile(ref: StoneObjectRef): string {
  return join(stoneDir(ref), "readable.ts");
}

/** 读取 readme.md，不存在返回 undefined。 */
/** @deprecated Use readReadable instead (2026-05-28 ooc-6 Object Unification). */
export async function readReadme(ref: StoneObjectRef): Promise<string | undefined> {
  try {
    return await readFile(readmeFile(ref), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

/**
 * 读取 readable.md，不存在返回 undefined。
 * 迁移期双读：优先 readable.md，fallback 到 readme.md。
 */
export async function readReadable(ref: StoneObjectRef): Promise<string | undefined> {
  try {
    return await readFile(readableFile(ref), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      // Migration fallback: try old readme.md path
      try {
        return await readFile(readmeFile(ref), "utf8");
      } catch (e2) {
        if ((e2 as NodeJS.ErrnoException).code === "ENOENT") return undefined;
        throw e2;
      }
    }
    throw error;
  }
}

/** 写入 readme.md，覆盖。 */
/** @deprecated Use writeReadable instead (2026-05-28 ooc-6 Object Unification). */
export async function writeReadme(ref: StoneObjectRef, text: string): Promise<void> {
  await writeFile(readmeFile(ref), text, "utf8");
}

/** 写入 readable.md，覆盖。迁移期双写：同时写 readable.md 和 readme.md。 */
export async function writeReadable(ref: StoneObjectRef, text: string): Promise<void> {
  await writeFile(readableFile(ref), text, "utf8");
  // Migration dual-write: also write to old readme.md path
  await writeFile(readmeFile(ref), text, "utf8");
}
