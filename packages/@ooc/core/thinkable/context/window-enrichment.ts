/**
 * Window enrichment utilities.
 *
 * 2026-06-10: onFormChange now returns MethodExecuteForm (tip + intents + quick_exec_submit)
 * instead of guidance windows. Form "knowledge entries" are gone — tip is rendered directly
 * on the form. This module now only resolves effectiveVisibleType.
 */
import type { ContextWindow, MethodExecWindow } from "../../executable/windows/_shared/types.js";
import type { ObjectRegistry } from "../../executable/windows/_shared/registry.js";
import { builtinRegistry } from "../../executable/windows/index.js";
import type { ThreadContext } from "./index.js";

/**
 * Enrich all context windows: resolve effectiveVisibleType along parentClass chain.
 *
 * Returns { enrichedWindows, formKnowledgeEntries } (formKnowledgeEntries is always empty
 * now that form guidance uses plain-string tip).
 */
export async function enrichContextWindows(
  windows: ContextWindow[] | undefined,
  thread: ThreadContext,
  registry: ObjectRegistry = builtinRegistry,
): Promise<{
  enrichedWindows: ContextWindow[];
  formKnowledgeEntries: Record<string, string>;
}> {
  const list = windows ?? [];
  const enriched: ContextWindow[] = [];

  for (const window of list) {
    const effVis = registry.resolveEffectiveVisibleType(window.type as any);
    const withVis: ContextWindow = effVis && effVis !== window.type
      ? { ...window, effectiveVisibleType: effVis }
      : window;
    enriched.push(withVis);
  }

  return { enrichedWindows: enriched, formKnowledgeEntries: {} };
}
