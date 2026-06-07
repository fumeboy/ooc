import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { stoneDir, type StoneObjectRef } from "./common";
import { resolveBuiltinReadDir } from "./builtin-dir";

/**
 * 读取 stone `package.json` 的权威继承声明 `ooc.class`（替代已删除的 self.md `prototype`
 * frontmatter）。不存在 / 解析失败 / 非字符串 → undefined。
 *
 * builtin（非 worktree ref）从框架包读 package.json；其余走 canonical `stoneDir`。
 */
export async function readStoneClass(ref: StoneObjectRef): Promise<string | undefined> {
  const dir = resolveBuiltinReadDir(ref) ?? stoneDir(ref);
  try {
    const raw = await readFile(join(dir, "package.json"), "utf8");
    const pkg = JSON.parse(raw) as { ooc?: { class?: unknown } };
    const cls = pkg?.ooc?.class;
    return typeof cls === "string" && cls.trim().length > 0 ? cls.trim() : undefined;
  } catch {
    return undefined;
  }
}
