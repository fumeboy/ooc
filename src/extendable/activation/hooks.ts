/**
 * 线程生命周期 Hook 收集与注入
 *
 * 精简后：只保留 command/defer 相关的 hook 收集。
 * 原先的 before/after/when_finish 等事件 hook 已随 TRAIT.md 的 hooks 字段一起下线，
 * 迁移到 TRAIT.md 正文（激活即可见），由 scope chain 的 readme 注入统一承担。
 *
 * @ref docs/superpowers/specs/2026-04-06-thread-tree-architecture-design.md#7
 */

import type { TraitDefinition } from "../../shared/types/index.js";
import type { ThreadFrameHook } from "../../thinkable/thread-tree/types.js";
/**
 * 获取 trait 的完整标识（本地版本，避免循环依赖）
 *
 * 与 activator.traitId 保持一致：`namespace:name`（冒号分隔）。
 */
function localTraitId(trait: TraitDefinition): string {
  return `${trait.namespace}:${trait.name}`;
}

/**
 * 收集应激活的 trait id 列表
 *
 * 单一规则：trait.activatesOn.showContentWhen 精确匹配 activePaths。
 *
 * 命中规则：
 * - declared path ∈ activePaths → 命中
 *
 * deriveCommandPaths() 已显式包含所有父路径（如 ["talk", "talk.continue"]），
 * 无需前缀匹配——父声明直接出现在 activePaths 中。
 * showDescriptionWhen 只展示摘要，不会进入 activatedTraits。
 * 没有 showContentWhen 的 trait 不会被作为完整正文激活。
 *
 * @param traits     - 所有已加载的 trait 定义
 * @param activePaths - 当前活跃 form 的 commandPaths 合并集合
 * @returns 需要激活的 trait ID 列表（按 traits 入参顺序，不会重复）
 *
 * @ref docs/superpowers/specs/2026-04-26-refine-tool-and-knowledge-activator.md
 */
export function collectCommandTraits(
  traits: TraitDefinition[],
  activePaths: Set<string>,
): string[] {
  if (activePaths.size === 0) return [];
  const result: string[] = [];
  for (const trait of traits) {
    const aoPaths = trait.activatesOn?.showContentWhen;
    if (!aoPaths || aoPaths.length === 0) continue;
    let hit = false;
    for (const decl of aoPaths) {
      if (activePaths.has(decl)) {
        hit = true;
        break;
      }
    }
    if (hit) result.push(localTraitId(trait));
  }
  return result;
}

/**
 * 收集 command hooks（defer 注册的 on:{command} 钩子）
 *
 * 在 command 被 submit 时调用，收集当前线程中匹配的 hooks。
 * 触发后，once !== false 的 hook 自动从 hooks 数组中移除。
 *
 * @param command - 被 submit 的 command 名称（如 "return", "talk"）
 * @param threadHooks - 当前线程的 hooks 数组（会被修改：移除 once hook）
 * @returns 合并后的注入文本，无匹配 hook 时返回 null
 */
export function collectCommandHooks(
  command: string,
  threadHooks: ThreadFrameHook[] | undefined,
): string | null {
  if (!threadHooks || threadHooks.length === 0) return null;

  const event = `on:${command}`;
  const injections: string[] = [];
  const toRemove: number[] = [];

  for (let i = 0; i < threadHooks.length; i++) {
    const hook = threadHooks[i];
    if (!hook) continue;
    if (hook.event !== event) continue;

    injections.push(hook.content);
    /* once 默认 true */
    if (hook.once !== false) {
      toRemove.push(i);
    }
  }

  /* 从后往前移除，避免索引偏移 */
  for (let i = toRemove.length - 1; i >= 0; i--) {
    const index = toRemove[i];
    if (index !== undefined) {
      threadHooks.splice(index, 1);
    }
  }

  if (injections.length === 0) return null;
  return `>>> [defer 提醒 — ${command}]\n${injections.join("\n")}`;
}
