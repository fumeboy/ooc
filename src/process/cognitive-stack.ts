/**
 * 认知栈核心模块 (G13)
 *
 * 对象的运行时是一个混合栈，每个栈帧同时携带过程（做什么）和思维（用什么来想）。
 * 活跃 traits 由作用域链自动计算：focus 路径上所有节点的 traits + activatedTraits。
 *
 * @ref docs/哲学文档/gene.md#G13 — implements — 认知栈作用域链计算
 * @ref src/process/tree.ts — references — getPathToNode, findNode
 * @ref src/types/process.ts — references — Process, ProcessNode
 * @ref src/types/trait.ts — references — TraitDefinition, TraitHook
 */

import type { Process, ProcessNode, FrameHook, HookTime, TraitDefinition } from "../types/index.js";
import { getPathToNode } from "./tree.js";
import { traitId } from "../knowledge/activator.js";

/**
 * 从 focus 路径计算作用域链（当前活跃的 traits 名称列表）
 *
 * activeTraits = alwaysOnTraits
 *              ∪ ⋃{ node.traits | node ∈ path(root → focus) }
 *              ∪ ⋃{ node.activatedTraits | node ∈ path(root → focus) }
 *
 * @param process - 行为树
 * @returns 去重后的 trait 名称列表
 */
export function computeScopeChain(process: Process): string[] {
  const path = getPathToNode(process.root, process.focusId);
  const seen = new Set<string>();

  for (const node of path) {
    if (node.traits) {
      for (const t of node.traits) seen.add(t);
    }
    if (node.activatedTraits) {
      for (const t of node.activatedTraits) seen.add(t);
    }
  }

  return Array.from(seen);
}

/**
 * 收集栈帧级 hooks（before/after）的注入文本
 *
 * 从作用域链中的 traits 收集指定事件的 hooks，
 * 跳过已触发的 once hooks（per-node 粒度），合并注入文本。
 *
 * @param event - "before" 或 "after"
 * @param traits - 所有已加载的 trait 定义
 * @param scopeChain - 当前作用域链中的 trait 名称
 * @param firedHooks - 已触发的 hook ID 集合（会被修改）
 * @param focusNodeId - 当前 focus 节点 ID（用于 per-node once 语义）
 * @returns 合并后的注入文本，无 hook 时返回 null
 */
export function collectFrameHooks(
  event: "before" | "after",
  traits: TraitDefinition[],
  scopeChain: string[],
  firedHooks: Set<string>,
  focusNodeId?: string,
): string | null {
  const scopeSet = new Set(scopeChain);
  const injections: string[] = [];

  for (const trait of traits) {
    /* 只收集作用域链中的 traits 或 always 激活的 traits */
    if (trait.when !== "always" && !scopeSet.has(traitId(trait))) continue;
    if (!trait.hooks) continue;

    const hook = trait.hooks[event];
    if (!hook) continue;

    /* per-node key: 同一 hook 在不同节点上各触发一次 */
    const hookId = focusNodeId
      ? `${traitId(trait)}:${event}:${focusNodeId}`
      : `${traitId(trait)}:${event}`;

    /* once: true 的 hook 只触发一次（per-node 粒度） */
    if (hook.once !== false && firedHooks.has(hookId)) continue;

    injections.push(hook.inject);
    firedHooks.add(hookId);
  }

  if (injections.length === 0) return null;
  return `>>> [系统提示 — ${event}]\n${injections.join("\n\n")}`;
}

/**
 * 收集指定节点上特定时机的 hooks
 *
 * when_stack_pop 按 LIFO 顺序返回（后注册先执行，与 Go defer 一致）。
 * 其他时机按 FIFO 顺序返回。
 *
 * @param node - 行为树节点
 * @param when - Hook 触发时机
 * @returns 匹配的 hooks 数组
 */
export function collectFrameNodeHooks(node: ProcessNode, when: HookTime): FrameHook[] {
  if (!node.hooks) return [];
  const matched = node.hooks.filter(h => h.when === when);
  return when === "when_stack_pop" ? [...matched].reverse() : matched;
}
