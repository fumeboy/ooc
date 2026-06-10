/**
 * WindowEnrichmentProcessor — resolves effectiveVisibleType on all context windows
 * (along the parentClass chain).
 *
 * form 指引为 plain-string tip 直渲于 form，不派生 form-scoped knowledge windows——
 * 本 processor 不产出新窗口，只原位 enrich。
 */
import type { PipelinePhase, PipelineContext } from "../pipeline.js";
import type { ThreadContext } from "../index.js";
import type { ContextWindow } from "../../../executable/windows/_shared/types.js";
import { builtinRegistry } from "../../../executable/windows/index.js";
import { enrichContextWindows } from "../window-enrichment.js";

export const WindowEnrichmentProcessor: PipelinePhase = {
  name: "WindowEnrichmentProcessor",
  async run(_thread: ThreadContext, ctx: PipelineContext): Promise<ContextWindow[]> {
    const enriched = enrichContextWindows(ctx.windows, builtinRegistry);
    ctx.windows.length = 0;
    ctx.windows.push(...enriched);
    return [];
  },
};
