import { readFile, readdir, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import {
  poolKnowledgeDir,
  stoneKnowledgeDir,
  type PoolObjectRef,
  type StoneObjectRef,
} from "../../persistable";
import { parseKnowledgeFile } from "./parser";
import type { KnowledgeDoc, KnowledgeIndex } from "./types";

/** 双源 loader 输入：stone (seed) + pool (sediment) 两个 ref。 */
export interface KnowledgeLoadRefs {
  /** stone 侧 ref（seed knowledge：`stones/<branch>/objects/<id>/knowledge/`，进 git）。 */
  stone: StoneObjectRef;
  /** pool 侧 ref（sediment knowledge：`pools/objects/<id>/knowledge/`，不进 git）。 */
  pool: PoolObjectRef;
}

/** 内部 cache：两侧目录组合签名 → { 上次索引 + 文件签名 }。 */
const cache = new Map<string, { index: KnowledgeIndex; signature: string }>();

/**
 * 双源加载 Object 的 knowledge 索引（2026-05-24 起：stone seed + pool sediment 合并）。
 *
 * 两侧扫描：
 * - seed：`stones/<branch>/objects/<id>/knowledge/`（设计层；进 git review）
 * - sediment：`pools/objects/<id>/knowledge/`（运行时认知；不进 git）
 *
 * 合并规则：
 * - 相对路径（去 .md 后缀）相同视为冲突；sediment 胜出（运行时认知覆盖先天），但 console.warn
 * - 由于 seed 一般在一级 `knowledge/<slug>.md`、sediment 在二级 `knowledge/memory|relations/<slug>.md`，
 *   实际冲突极少；防御性代码保证安全
 *
 * 容错：
 * - 任一侧目录 ENOENT/不可读 → 静默继续扫另一侧，不报错
 *
 * Cache：以两侧 (path, mtime) 联合签名为键；签名未变即返回上次索引（同对象引用）。
 */
export async function loadKnowledgeIndex(refs: KnowledgeLoadRefs): Promise<KnowledgeIndex> {
  const stoneRoot = stoneKnowledgeDir(refs.stone);
  const poolRoot = poolKnowledgeDir(refs.pool);

  const stoneFiles = await collectMdFiles(stoneRoot);
  const poolFiles = await collectMdFiles(poolRoot);

  const signature = [
    `stone:${stoneRoot}`,
    ...stoneFiles.map((f) => `s:${f.path}@${f.mtime}`).sort(),
    `pool:${poolRoot}`,
    ...poolFiles.map((f) => `p:${f.path}@${f.mtime}`).sort(),
  ].join("|");

  const cacheKey = `${stoneRoot}::${poolRoot}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.signature === signature) {
    return cached.index;
  }

  const byPath = new Map<string, KnowledgeDoc>();

  // 先加载 seed（stone 侧）—— 让 sediment 在 set 时自然覆盖并触发 warn
  for (const f of stoneFiles) {
    const text = await readFile(f.path, "utf8");
    const { frontmatter, body } = parseKnowledgeFile(text);
    const idPath = toIdPath(stoneRoot, f.path);
    byPath.set(idPath, {
      path: idPath,
      file: f.path,
      frontmatter,
      body,
      mtime: f.mtime,
    });
  }

  // 后加载 sediment（pool 侧）—— 同 idPath 时覆盖 seed 并 warn
  for (const f of poolFiles) {
    const text = await readFile(f.path, "utf8");
    const { frontmatter, body } = parseKnowledgeFile(text);
    const idPath = toIdPath(poolRoot, f.path);
    if (byPath.has(idPath)) {
      const prev = byPath.get(idPath)!;
      console.warn(
        `[knowledge-loader] conflict path="${idPath}" seed=${prev.file} sediment=${f.path} resolution=sediment_wins`,
      );
    }
    byPath.set(idPath, {
      path: idPath,
      file: f.path,
      frontmatter,
      body,
      mtime: f.mtime,
    });
  }

  const index: KnowledgeIndex = { byPath };
  cache.set(cacheKey, { index, signature });
  return index;
}

/** 测试钩子：清空 loader 缓存。 */
export function clearKnowledgeLoaderCache(): void {
  cache.clear();
}

/** 相对路径（去 .md 后缀，统一斜杠）作为 KnowledgeDoc.path 的 idPath。 */
function toIdPath(root: string, abs: string): string {
  const rel = relative(root, abs).replace(/\.md$/, "");
  return rel.split(/[\\/]/).join("/");
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
