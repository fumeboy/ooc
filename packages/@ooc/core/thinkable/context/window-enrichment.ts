/**
 * Window enrichment utilities.
 *
 * 仅沿 parentClass 链解析各窗口的 effectiveVisibleType（form 指引现为 plain-string tip
 * 直渲于 form，不派生 guidance/knowledge 窗口）。
 */
import type { ContextWindow } from "../../executable/windows/_shared/types.js";
import type { ObjectRegistry } from "../../executable/windows/_shared/registry.js";
import { builtinRegistry } from "../../executable/windows/index.js";

/** Enrich context windows: resolve effectiveVisibleType along the parentClass chain. */
export function enrichContextWindows(
  windows: ContextWindow[] | undefined,
  registry: ObjectRegistry = builtinRegistry,
): ContextWindow[] {
  return (windows ?? []).map((window) => {
    const effVis = registry.resolveEffectiveVisibleType(window.type as any);
    return effVis && effVis !== window.type
      ? { ...window, effectiveVisibleType: effVis }
      : window;
  });
}
