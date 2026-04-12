/**
 * Trait 激活器 (G3/G13)
 *
 * 决定哪些 Trait 在当前 think 中被激活。
 * G13 认知栈：激活由作用域链驱动（focus 路径上节点声明的 traits）。
 * 激活 = TRAIT.md 完整内容注入 context（instructions + knowledge）。
 * 方法注册不受激活影响（全量注册）。
 *
 * @ref docs/哲学文档/gene.md#G3 — implements — Trait 激活逻辑（always/never/条件）
 * @ref docs/哲学文档/gene.md#G13 — implements — 认知栈作用域链驱动 trait 激活
 * @ref docs/哲学文档/gene.md#G5 — references — 激活决定 context 中注入哪些 Trait 内容
 * @ref src/types/trait.ts — references — TraitDefinition 类型
 */

import type { TraitDefinition } from "../types/index.js";

/**
 * 获取 trait 的完整标识
 *
 * @param trait - Trait 定义
 * @returns trait 的完整路径名（如 "kernel/computable"）
 */
export function traitId(trait: TraitDefinition): string {
  // 兼容旧格式：如果 name 不含 namespace 前缀但 namespace 存在，则拼接
  if (trait.namespace && !trait.name.startsWith(trait.namespace + "/")) {
    return `${trait.namespace}/${trait.name}`;
  }
  return trait.name;
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
