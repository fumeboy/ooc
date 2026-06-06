import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { stoneDir, type StoneObjectRef } from "./common";
import { resolveBuiltinReadDir } from "./builtin-dir";

/** stone 的身份说明文件 self.md 的 canonical（写）绝对路径。 */
export function selfFile(ref: StoneObjectRef): string {
  return join(stoneDir(ref), "self.md");
}

/**
 * 读取 self.md，不存在返回 undefined。
 *
 * builtin（非 worktree ref）的 self.md 从**框架包**读（`resolveBuiltinReadDir`）——修
 * 旧路径指向空 `<world>/packages/@ooc/builtins/` 导致 builtin 身份磁盘空读的 bug。
 * 非 builtin 走 canonical `selfFile`。
 */
export async function readSelf(ref: StoneObjectRef): Promise<string | undefined> {
  const builtinDir = resolveBuiltinReadDir(ref);
  const path = builtinDir ? join(builtinDir, "self.md") : selfFile(ref);
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

/** 写入 self.md，覆盖。 */
export async function writeSelf(ref: StoneObjectRef, text: string): Promise<void> {
  await writeFile(selfFile(ref), text, "utf8");
}
