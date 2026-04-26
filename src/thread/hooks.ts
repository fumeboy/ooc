/**
 * 线程生命周期 Hook 收集与注入
 *
 * 精简后：只保留 command/defer 相关的 hook 收集。
 * 原先的 before/after/when_finish 等事件 hook 已随 TRAIT.md 的 hooks 字段一起下线，
 * 迁移到 TRAIT.md 正文（激活即可见），由 scope chain 的 readme 注入统一承担。
 *
 * @ref docs/superpowers/specs/2026-04-06-thread-tree-architecture-design.md#7
 */

import type { TraitDefinition } from "../types/index.js";
import type { ThreadFrameHook } from "./types.js";
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
 * 单一规则：trait.activatesOn.paths 反向声明（前缀匹配）。
 *
 * 命中规则：
 * - active path === declared path → 命中
 * - active path 以 (declared path + ".") 开头 → 命中（父声明覆盖子路径）
 *
 * 没有 activatesOn 的 trait 永不命中（Task 14：旧 command_binding fallback 已移除）。
 *
 * @param traits     - 所有已加载的 trait 定义
 * @param activePaths - 当前活跃 form 的 commandPath 集合
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
    const aoPaths = trait.activatesOn?.paths;
    if (!aoPaths || aoPaths.length === 0) continue;
    let hit = false;
    outer: for (const decl of aoPaths) {
      for (const ap of activePaths) {
        if (ap === decl || ap.startsWith(decl + ".")) {
          hit = true;
          break outer;
        }
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
    if (hook.event !== event) continue;

    injections.push(hook.content);
    /* once 默认 true */
    if (hook.once !== false) {
      toRemove.push(i);
    }
  }

  /* 从后往前移除，避免索引偏移 */
  for (let i = toRemove.length - 1; i >= 0; i--) {
    threadHooks.splice(toRemove[i], 1);
  }

  if (injections.length === 0) return null;
  return `>>> [defer 提醒 — ${command}]\n${injections.join("\n")}`;
}
