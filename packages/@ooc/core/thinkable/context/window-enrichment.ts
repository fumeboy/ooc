/**
 * Window enrichment utilities.
 *
 * 2026-06-10: onFormChange now returns MethodExecuteForm (tip + intents + quick_exec_submit)
 * instead of guidance windows — form knowledge synthesis is gone. This module only
 * resolves effectiveVisibleType along the parentClass chain.
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
