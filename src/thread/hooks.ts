/**
 * 线程生命周期 Hook 收集与注入
 *
 * 简化版 hook 系统：只有 before 和 after 两种事件。
 * - before：create_sub_thread 时注入子线程首轮 Context
 * - after：return 时注入创建者线程下一轮 Context
 *
 * Hook 内容是纯文本，不是可执行代码，天然非递归。
 *
 * 收集来源：
 * 1. scope chain 上的 TraitDefinition.hooks（trait 级 hook）
 * 2. ThreadFrameHook[]（thread.json 中的 hooks 字段，节点级 hook）
 *
 * @ref docs/superpowers/specs/2026-04-06-thread-tree-architecture-design.md#7
 */

import type { TraitDefinition } from "../types/index.js";
import type { ThreadFrameHook } from "./types.js";

/**
 * 获取 trait 的完整标识（本地版本，避免循环依赖）
 */
function localTraitId(trait: TraitDefinition): string {
  if (trait.namespace && !trait.name.startsWith(trait.namespace + "/")) {
    return `${trait.namespace}/${trait.name}`;
  }
  return trait.name;
}

/**
 * 收集 before hooks（create_sub_thread 时调用）
 *
 * @param traits - 所有已加载的 trait 定义
 * @param scopeChain - 当前线程的 scope chain（trait 名称列表）
 * @param firedHooks - 已触发的 hook ID 集合（会被修改）
 * @param threadHooks - 线程级 hooks（来自 thread.json）
 * @returns 合并后的注入文本，无 hook 时返回 null
 */
export function collectBeforeHooks(
  traits: TraitDefinition[],
  scopeChain: string[],
  firedHooks: Set<string>,
  threadHooks?: ThreadFrameHook[],
): string | null {
  return collectHooksByEvent("before", traits, scopeChain, firedHooks, threadHooks);
}

/**
 * 收集 after hooks（return 时调用）
 *
 * @param traits - 所有已加载的 trait 定义
 * @param scopeChain - 创建者线程的 scope chain
 * @param firedHooks - 已触发的 hook ID 集合（会被修改）
 * @param threadHooks - 线程级 hooks
 * @returns 合并后的注入文本，无 hook 时返回 null
 */
export function collectAfterHooks(
  traits: TraitDefinition[],
  scopeChain: string[],
  firedHooks: Set<string>,
  threadHooks?: ThreadFrameHook[],
): string | null {
  return collectHooksByEvent("after", traits, scopeChain, firedHooks, threadHooks);
}

/**
 * 按事件类型收集 hooks（内部实现）
 */
function collectHooksByEvent(
  event: "before" | "after",
  traits: TraitDefinition[],
  scopeChain: string[],
  firedHooks: Set<string>,
  threadHooks?: ThreadFrameHook[],
): string | null {
  const injections: string[] = [];
  const scopeSet = new Set(scopeChain);

  /* 1. 从 scope chain 上的 traits 收集 */
  for (const trait of traits) {
    const id = localTraitId(trait);
    /* 只收集 scope chain 中的 traits */
    if (!scopeSet.has(id)) continue;
    if (!trait.hooks) continue;

    const hook = trait.hooks[event];
    if (!hook) continue;

    const hookId = `${id}:${event}`;
    /* once hook 不重复触发 */
    if (hook.once !== false && firedHooks.has(hookId)) continue;

    injections.push(hook.inject);
    firedHooks.add(hookId);
  }

  /* 2. 从 thread.json 的 hooks 字段收集 */
  if (threadHooks) {
    for (const hook of threadHooks) {
      if (hook.event !== event) continue;

      const hookId = `thread:${hook.traitName}:${event}`;
      if (hook.once !== false && firedHooks.has(hookId)) continue;

      injections.push(hook.content);
      firedHooks.add(hookId);
    }
  }

  if (injections.length === 0) return null;
  return `>>> [系统提示 — ${event}]\n${injections.join("\n\n")}`;
}

/**
 * 收集指令绑定的 trait，返回需要加载的 trait ID 列表
 *
 * 遍历所有 trait，检查 commandBinding.commands 是否与 activeCommands 有交集。
 *
 * @param traits - 所有已加载的 trait 定义
 * @param activeCommands - 当前活跃的指令类型集合
 * @returns 需要激活的 trait ID 列表
 */
export function collectCommandTraits(
  traits: TraitDefinition[],
  activeCommands: Set<string>,
): string[] {
  if (activeCommands.size === 0) return [];

  const result: string[] = [];
  for (const trait of traits) {
    const binding = trait.commandBinding;
    if (!binding?.commands?.length) continue;

    for (const cmd of binding.commands) {
      if (activeCommands.has(cmd)) {
        result.push(localTraitId(trait));
        break;
      }
    }
  }
  return result;
}
