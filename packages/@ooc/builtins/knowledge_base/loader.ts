/**
 * knowledge loader —— 双源 (stone seed + pool sediment) 合并。
 *
 * 当前最小：扫单个 owner objectId 的两层目录，frontmatter 解析 → KnowledgeIndex。
 * 不做继承链（待 reflectable 重建时补）。
 *
 * - stone seed：`<baseDir>/stones/main/objects/<owner>/knowledge/*.md`
 * - pool sediment：`<baseDir>/pools/objects/<owner>/knowledge/*.md`（同 path 覆盖 seed）
 */
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import type { KnowledgeDoc, KnowledgeIndex } from "./activator/types.js";
import { parseKnowledgeFile } from "./activator/parser.js";

async function scanDir(root: string, idPrefix = ""): Promise<KnowledgeDoc[]> {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw e;
  }
  const out: KnowledgeDoc[] = [];
  for (const e of entries) {
    const full = join(root, e.name);
    if (e.isDirectory()) {
      out.push(...(await scanDir(full, idPrefix ? `${idPrefix}/${e.name}` : e.name)));
      continue;
    }
    if (!e.name.endsWith(".md")) continue;
    const idPath = idPrefix ? `${idPrefix}/${e.name.slice(0, -3)}` : e.name.slice(0, -3);
    try {
      const text = await readFile(full, "utf8");
      const stats = await stat(full);
      const { frontmatter, body } = parseKnowledgeFile(text);
      out.push({ path: idPath, file: full, frontmatter, body, mtime: stats.mtimeMs });
    } catch (err) {
      console.warn(`[knowledge.loader] parse fail ${full}: ${(err as Error).message}`);
    }
  }
  return out;
}

/** 加载某 owner 的 knowledge 索引 —— stone seed + pool sediment 合并（sediment 覆盖 seed）。 */
export async function loadKnowledgeIndex(
  baseDir: string,
  ownerObjectId: string,
): Promise<KnowledgeIndex> {
  const seedDir = join(baseDir, "stones", "main", "objects", ownerObjectId, "knowledge");
  const sedimentDir = join(baseDir, "pools", "objects", ownerObjectId, "knowledge");
  const seed = await scanDir(seedDir);
  const sediment = await scanDir(sedimentDir);
  const byPath = new Map<string, KnowledgeDoc>();
  for (const d of seed) byPath.set(d.path, d);
  for (const d of sediment) byPath.set(d.path, d); // sediment 覆盖 seed
  return { byPath };
}
