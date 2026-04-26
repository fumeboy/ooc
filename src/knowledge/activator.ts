/**
 * Knowledge 激活器（原 Trait Activator 升级）
 *
 * 决定哪些 Knowledge（trait / view / relation）在当前 think 中被激活。
 * 沿用 G3/G13 设计：激活由作用域链 + 反向索引驱动。
 *
 * @ref docs/superpowers/specs/2026-04-26-refine-tool-and-knowledge-activator.md
 * @ref docs/哲学文档/gene.md#G3 — implements — 激活逻辑（always/never/条件）
 * @ref docs/哲学文档/gene.md#G13 — implements — 认知栈作用域链驱动激活
 * @ref docs/哲学文档/gene.md#G5 — references — 激活决定 context 中注入哪些知识内容
 */

import type { TraitDefinition } from "../types/index.js";

/**
 * 获取 trait 的完整标识
 *
 * 新格式（硬迁移）：`<namespace>:<name>`（冒号分隔）。
 *
 * @param trait - Trait 定义
 * @returns trait 的 traitId（如 "kernel:computable", "library:lark/doc", "self:reporter"）
 */
export function traitId(trait: TraitDefinition): string {
  return `${trait.namespace}:${trait.name}`;
}

/**
 * 解析 trait 引用（可能省略 namespace）到完整 traitId
 *
 * 规则：
 * - 若 raw 含 `:` → 直接作为完整 traitId 返回（原样）
 * - 否则按 `self:{raw}` → `kernel:{raw}` → `library:{raw}` 顺序在候选集合中查找，
 *   取第一个命中
 * - 全部未命中 → 返回 null
 *
 * @param raw - 可能省略 namespace 的 trait 引用（如 "computable" 或 "kernel:computable"）
 * @param available - 已加载的 trait 集合（用于判断 namespace 省略时按优先级查找）
 */
export function resolveTraitRef(
  raw: string,
  available: Iterable<TraitDefinition>,
): string | null {
  if (raw.includes(":")) {
    const exists = Array.from(available).some((t) => traitId(t) === raw);
    return exists ? raw : null;
  }
  const byId = new Set<string>();
  for (const t of available) byId.add(traitId(t));
  for (const ns of ["self", "kernel", "library"] as const) {
    const candidate = `${ns}:${raw}`;
    if (byId.has(candidate)) return candidate;
  }
  return null;
}

/**
 * 获取应该激活的 Traits（完整内容注入 context）
 *
 * 激活规则：
 * - when = "always" → 自动激活
 * - when = "never" → 不激活（除非被依赖）
 * - 其他（自然语言条件） → 仅当 "namespace/name" 出现在 scopeChain 中时激活
 *
 * @param traits - 所有已加载的 Trait
 * @param scopeChain - 从 computeScopeChain 计算的栈帧 traits（格式："namespace/name"）
 * @returns 应该激活的 Trait 列表
 */
export function getActiveTraits(
  traits: TraitDefinition[],
  scopeChain: string[] = [],
): TraitDefinition[] {
  const traitMap = new Map(traits.map((t) => [traitId(t), t]));
  const scopeSet = new Set(scopeChain);
  const activated = new Set<string>();
  const result: TraitDefinition[] = [];

  /** 递归激活（处理依赖） */
  function activate(trait: TraitDefinition): void {
    const id = traitId(trait);
    if (activated.has(id)) return;
    activated.add(id);

    /* 先激活依赖 */
    for (const depRef of trait.deps) {
      const dep = traitMap.get(depRef);
      if (dep) activate(dep);
    }

    result.push(trait);
  }

  for (const trait of traits) {
    const id = traitId(trait);

    if (trait.when === "never" && !scopeSet.has(id)) continue;
    if (trait.when === "always") {
      activate(trait);
      continue;
    }

    /* 条件 trait：仅当 "namespace/name" 出现在作用域链中时激活 */
    if (scopeSet.has(id)) {
      activate(trait);
    }
  }

  return result;
}

/**
 * 获取指定父 trait 的子 trait 列表
 *
 * @param allTraits - 所有已加载的 trait
 * @param parentId - 父 trait ID
 * @returns 子 trait 列表
 */
export function getChildTraits(
  allTraits: TraitDefinition[],
  parentId: string,
): TraitDefinition[] {
  return allTraits.filter(
    (t) => t.parent === parentId,
  );
}

import type { KnowledgeRef } from "./types.js";
import { buildPathReverseIndex, lookupTraitsByPaths, type PathReverseIndex } from "./reverse-index.js";

export interface ComputeRefsInput {
  /** 已加载 traits/views/relations（统一通过 TraitDefinition 形态承载） */
  traits: TraitDefinition[];
  /** 当前活跃 form 的 commandPath 集合 */
  activePaths: Set<string>;
  /** 可选：预先构建好的反向索引（性能优化：调用方可缓存） */
  reverseIndex?: PathReverseIndex;
}

/**
 * 基于反向索引计算当前应激活的 KnowledgeRef[]（form_match 维度）
 *
 * origin / relation / open_action 维度后续 Task 加入。当前只产出 trait 类型；
 * Task 15 将根据 t.kind 区分出 view 类型；Task 16 将根据 peers 输入产出 relation。
 */
export function computeKnowledgeRefs(input: ComputeRefsInput): KnowledgeRef[] {
  const idx = input.reverseIndex ?? buildPathReverseIndex(input.traits);
  const traitMap = new Map(input.traits.map((t) => [traitId(t), t]));
  const hitIds = lookupTraitsByPaths(idx, input.activePaths);

  const refs: KnowledgeRef[] = [];
  for (const id of hitIds) {
    const t = traitMap.get(id);
    if (!t) continue;
    /* 找到这条 trait 是被哪个 activePath 命中的（取第一个匹配的，仅用于 reason） */
    let matchedPath = "";
    if (t.activatesOn?.paths) {
      outer: for (const ap of input.activePaths) {
        for (const decl of t.activatesOn.paths) {
          if (ap === decl || ap.startsWith(decl + ".")) {
            matchedPath = ap;
            break outer;
          }
        }
      }
    }
    const knowledgeType: "trait" | "view" = t.kind === "view" ? "view" : "trait";
    const refPrefix = knowledgeType === "view" ? "@view" : "@trait";
    refs.push({
      type: knowledgeType,
      ref: `${refPrefix}:${t.name}`,
      source: { kind: "form_match", path: matchedPath },
      presentation: "full",
      reason: `命令路径命中 ${knowledgeType} ${t.namespace}:${t.name}`,
    });
  }
  return refs;
}
