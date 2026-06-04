/**
 * ActivatorProcessor — matches knowledge frontmatter triggers against thread intents.
 *
 * Produces KnowledgeWindow entries with source="activator".
 * Replaces synthesizer.collectExecutableKnowledgeEntries Phase 3.
 */
import type { PipelinePhase, PipelineContext } from "../pipeline.js";
import type { ThreadContext } from "../index.js";
import type { ContextWindow } from "../../../executable/windows/_shared/types.js";
import { buildActivatorKnowledgeWindows } from "../activator-windows.js";

export const ActivatorProcessor: PipelinePhase = {
  name: "ActivatorProcessor",
  async run(thread: ThreadContext, _ctx: PipelineContext): Promise<ContextWindow[]> {
    return buildActivatorKnowledgeWindows(thread);
  },
};
