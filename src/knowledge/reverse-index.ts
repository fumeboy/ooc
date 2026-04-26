/**
 * Knowledge 反向索引
 *
 * 输入一组 knowledge 文件（trait / view / relation），按各自 frontmatter 的
 * activates_on.paths 反向建表：path -> [traitId]。
 * 用于 Activator 在每次 refine 后快速查"当前路径命中哪些 knowledge"。
 *
 * @ref docs/superpowers/specs/2026-04-26-refine-tool-and-knowledge-activator.md
 */

import type { TraitDefinition } from "../types/index.js";
import { traitId } from "./activator.js";

export type PathReverseIndex = Map<string, string[]>;

/**
 * 扫描一组 trait/view/relation，按其 activates_on.paths 反向建表。
 *
 * 同一 path 下多 trait 按出现顺序追加；同一 (path, trait) 重复不会重复追加。
 */
export function buildPathReverseIndex(traits: TraitDefinition[]): PathReverseIndex {
  const idx: PathReverseIndex = new Map();
  for (const t of traits) {
    const paths = t.activatesOn?.paths;
    if (!paths || paths.length === 0) continue;
    const id = traitId(t);
    for (const p of paths) {
      const list = idx.get(p);
      if (list) {
        if (!list.includes(id)) list.push(id);
      } else {
        idx.set(p, [id]);
      }
    }
  }
  return idx;
}

/**
 * 根据 active path 集合查反向索引，返回命中的 traitId 列表（去重）。
 *
 * 命中规则：path 前缀匹配——
 * - active path === declared path → 命中
 * - active path 以 (declared path + ".") 开头 → 命中（父声明覆盖子路径）
 *
 * 等价于 thread/command-tree.matchesCommandPath。
 */
export function lookupTraitsByPaths(
  idx: PathReverseIndex,
  activePaths: Set<string>,
): string[] {
  const hit = new Set<string>();
  for (const ap of activePaths) {
    for (const [decl, ids] of idx.entries()) {
      if (ap === decl || ap.startsWith(decl + ".")) {
        for (const id of ids) hit.add(id);
      }
    }
  }
  return Array.from(hit);
}
