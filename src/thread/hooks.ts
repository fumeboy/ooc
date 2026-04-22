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
