import { readFile, readdir, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { knowledgeDir, type StoneObjectRef } from "../../persistable";
import { parseKnowledgeFile } from "./parser";
import type { KnowledgeDoc, KnowledgeIndex } from "./types";

/** 内部 cache：根目录 → { 上次索引 + 文件签名 }。 */
const cache = new Map<string, { index: KnowledgeIndex; signature: string }>();

/**
 * 加载 stone 的 knowledge 索引。
 *
 * - 第一次：递归扫 knowledge/ 下所有 .md，解析 frontmatter + body
 * - 后续：按 "文件路径 + mtime" 组成签名；签名未变即返回上次索引（同一对象引用）
 *
 * memory/ / relations/ 也是 knowledge 的一部分，按相对路径作为 ID（如 memory/index）。
 */
export async function loadKnowledgeIndex(ref: StoneObjectRef): Promise<KnowledgeIndex> {
  const root = knowledgeDir(ref);
  const files = await collectMdFiles(root);
  const signature = files
    .map((f) => `${f.path}@${f.mtime}`)
    .sort()
    .join("|");
  const cached = cache.get(root);
  if (cached && cached.signature === signature) {
    return cached.index;
  }

  const byPath = new Map<string, KnowledgeDoc>();
  for (const f of files) {
    const text = await readFile(f.path, "utf8");
    const { frontmatter, body } = parseKnowledgeFile(text);
    const rel = relative(root, f.path).replace(/\.md$/, "");
    const idPath = rel.split(/[\\/]/).join("/"); // 统一斜杠
    byPath.set(idPath, {
      path: idPath,
      file: f.path,
      frontmatter,
      body,
      mtime: f.mtime
    });
  }

  const index: KnowledgeIndex = { byPath };
  cache.set(root, { index, signature });
  return index;
}

/** 测试钩子：清空 loader 缓存。 */
export function clearKnowledgeLoaderCache(): void {
  cache.clear();
}

async function collectMdFiles(root: string): Promise<Array<{ path: string; mtime: number }>> {
  const result: Array<{ path: string; mtime: number }> = [];
  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        await walk(p);
      } else if (e.isFile() && e.name.endsWith(".md")) {
        const s = await stat(p);
        result.push({ path: p, mtime: s.mtimeMs });
      }
    }
  }
  await walk(root);
  return result;
}
