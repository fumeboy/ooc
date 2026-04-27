/**
 * Knowledge 激活器（原 Trait Activator 升级）
 *
 * 决定哪些 Knowledge（trait / view / relation）在当前 think 中被激活。
 * 沿用 G3/G13 设计：激活由作用域链 + 反向索引驱动。
 *
 * @ref docs/superpowers/specs/2026-04-26-refine-tool-and-knowledge-activator.md
 * @ref docs/哲学文档/gene.md#G3 — implements — 激活逻辑（scope chain / explicit activation）
 * @ref docs/哲学文档/gene.md#G13 — implements — 认知栈作用域链驱动激活
 * @ref docs/哲学文档/gene.md#G5 — references — 激活决定 context 中注入哪些知识内容
 */

import type { TraitDefinition } from "../../types/index.js";

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
 * - `kernel:base` 是协议基座，默认激活
 * - 其他 trait 仅当完整 traitId 出现在 scopeChain 中时激活
 * - deps 递归激活
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

    if (id === "kernel:base" || scopeSet.has(id)) {
      activate(trait);
    }
  }

  return result;
}

import type { KnowledgeRef } from "./types.js";
import { buildPathReverseIndex, lookupKnowledgeByPaths, type PathReverseIndex } from "./reverse-index.js";

export interface ComputeRefsInput {
  /** 已加载 traits/views/relations（统一通过 TraitDefinition 形态承载） */
  traits: TraitDefinition[];
  /** 当前活跃 form 的 commandPaths 合并集合（来自 FormManager.activeCommandPaths()） */
  activePaths: Set<string>;
  /** 可选：预先构建好的反向索引（性能优化：调用方可缓存） */
  reverseIndex?: PathReverseIndex;
  /** 协作 peers — 每个 peer 自动产出 summary-presentation 的 relation ref */
  peers?: string[];
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
  const hits = lookupKnowledgeByPaths(idx, input.activePaths);

  const refs: KnowledgeRef[] = [];
  for (const hit of hits) {
    const id = hit.id;
    const t = traitMap.get(id);
    if (!t) continue;
    const knowledgeType: "trait" | "view" = t.kind === "view" ? "view" : "trait";
    const refPrefix = knowledgeType === "view" ? "@view" : "@trait";
    refs.push({
      type: knowledgeType,
      ref: `${refPrefix}:${t.name}`,
      source: { kind: "form_match", path: hit.matchedPath },
      presentation: hit.presentation,
      reason: `命令路径命中 ${knowledgeType} ${t.namespace}:${t.name}`,
    });
  }
  /* relation 维度：peers → summary refs */
  if (input.peers) {
    for (const peer of input.peers) {
      refs.push({
        type: "relation",
        ref: `@relation:${peer}`,
        source: { kind: "relation", path: `@relation:${peer}` },
        presentation: "summary",
        reason: `当前线程协作伙伴 ${peer}`,
      });
    }
  }

  return refs;
}
