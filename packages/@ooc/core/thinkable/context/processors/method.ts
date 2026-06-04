/**
 * MethodFormProcessor — enriches method_exec forms and derives form-scoped knowledge windows.
 *
 * This processor:
 * 1. Mutates ctx.windows in-place: for each method_exec form, it computes
 *    effectiveVisibleType + commandKnowledgePaths (from onFormChange guidance)
 * 2. Produces additional KnowledgeWindow entries derived from each form's
 *    onFormChange guidance output.
 *
 * Sharing-state forms (ref / lent_out) are skipped for knowledge derivation.
 */
import type { PipelinePhase, PipelineContext } from "../pipeline.js";
import type { ThreadContext } from "../index.js";
import type { ContextWindow } from "../../../executable/windows/_shared/types.js";
import { builtinRegistry } from "../../../executable/windows/index.js";
import { enrichContextWindows } from "../window-enrichment.js";

export const MethodFormProcessor: PipelinePhase = {
  name: "MethodFormProcessor",
  async run(thread: ThreadContext, ctx: PipelineContext): Promise<ContextWindow[]> {
    // Enrich existing windows (effectiveVisibleType + commandKnowledgePaths on forms)
    const { enrichedWindows, formKnowledgeEntries } = await enrichContextWindows(
      ctx.windows,
      thread,
      builtinRegistry,
    );
    // Replace ctx.windows with enriched version
    ctx.windows.length = 0;
    ctx.windows.push(...enrichedWindows);

    // Convert form knowledge entries → KnowledgeWindow source=protocol (not already present)
    const existingPaths = new Set(
      ctx.windows
        .filter((w) => w.type === "knowledge")
        .map((w) => (w as any).path),
    );

    const out: ContextWindow[] = [];
    let counter = 0;
    for (const [path, body] of Object.entries(formKnowledgeEntries)) {
      if (existingPaths.has(path)) continue;
      out.push({
        id: `kn_form_${Date.now().toString(36)}_${counter++}`,
        type: "knowledge",
        parentWindowId: "root",
        title: path,
        status: "open",
        createdAt: Date.now(),
        path,
        source: "protocol",
        body,
      } as any);
    }

    return out;
  },
};
