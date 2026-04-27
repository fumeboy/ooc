/**
 * Knowledge 反向索引
 *
 * 输入一组 knowledge 文件（trait / view / relation），按各自 frontmatter 的
 * activates_on.show_description_when / show_content_when 反向建表：
 * path -> [{ traitId, presentation }]。
 * 用于 Activator 在每次 refine 后快速查"当前路径命中哪些 knowledge"。
 *
 * @ref docs/superpowers/specs/2026-04-26-refine-tool-and-knowledge-activator.md
 */

import type { TraitDefinition } from "../../types/index.js";
import { traitId } from "./activator.js";

export type PathReverseIndexEntry = {
  id: string;
  presentation: "summary" | "full";
};

export type PathReverseIndex = Map<string, PathReverseIndexEntry[]>;

/**
 * 扫描一组 trait/view/relation，按其 activates_on.show_*_when 反向建表。
 *
 * 同一 path 下多 trait 按出现顺序追加；同一 (path, trait, presentation) 重复不会重复追加。
 */
export function buildPathReverseIndex(traits: TraitDefinition[]): PathReverseIndex {
  const idx: PathReverseIndex = new Map();
  for (const t of traits) {
    const id = traitId(t);
    addEntries(idx, id, t.activatesOn?.showDescriptionWhen, "summary");
    addEntries(idx, id, t.activatesOn?.showContentWhen, "full");
  }
  return idx;
}

/** 向反向索引追加一组路径声明。 */
function addEntries(
  idx: PathReverseIndex,
  id: string,
  paths: string[] | undefined,
  presentation: PathReverseIndexEntry["presentation"],
): void {
  if (!paths || paths.length === 0) return;
  for (const p of paths) {
    const entry = { id, presentation };
    const list = idx.get(p);
    if (list) {
      if (!list.some((x) => x.id === id && x.presentation === presentation)) list.push(entry);
    } else {
      idx.set(p, [entry]);
    }
  }
}

export type PathReverseIndexHit = PathReverseIndexEntry & {
  matchedPath: string;
};

/**
 * 根据 active path 集合查反向索引，返回命中的 knowledge 条目（去重）。
 *
 * 去重键包含 presentation：同一 knowledge 可同时以 summary/full 两种形态命中。
 */
export function lookupKnowledgeByPaths(
  idx: PathReverseIndex,
  activePaths: Set<string>,
): PathReverseIndexHit[] {
  const hit = new Set<string>();
  const result: PathReverseIndexHit[] = [];
  for (const ap of activePaths) {
    const entries = idx.get(ap);
    if (!entries) continue;
    for (const entry of entries) {
      const key = `${entry.id}\0${entry.presentation}`;
      if (hit.has(key)) continue;
      hit.add(key);
      result.push({ ...entry, matchedPath: ap });
    }
  }
  return result;
}
