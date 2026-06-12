import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { stoneDir, type StoneObjectRef } from "./common";
import { resolveBuiltinReadDir } from "./builtin-dir";

/**
 * stone 的 readable.md 绝对路径。
 * 静态展示文本，供外部 Object 或 user 理解该 Object。
 */
export function readableFile(ref: StoneObjectRef): string {
  return join(stoneDir(ref), "readable.md");
}

/**
 * 读取 readable.md，不存在返回 undefined。
 */
export async function readReadable(ref: StoneObjectRef): Promise<string | undefined> {
  // builtin（非 worktree）的 readable.md 从框架包读（同 readSelf 的 builtin 修复）。
  const builtinDir = resolveBuiltinReadDir(ref);
  if (builtinDir) {
    try {
      return await readFile(join(builtinDir, "readable.md"), "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  }
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
