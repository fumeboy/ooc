/**
 * SystemProcessor — produces protocol knowledge windows.
 *
 * Covers: basic type-level knowledge, root commands, reflectable (super-session),
 * creator-reply protocol, end-reflection reminder.
 *
 * The logic currently lives in synthesizer.ts Phase 1 (inside collectExecutableKnowledgeEntries).
 * For now, this processor is a thin no-op — the old synthesizer path still runs in
 * buildInputItems. When the migration to ContextPipeline is complete, the protocol
 * logic will be extracted into standalone functions and called from here.
 */
import type { PipelinePhase, PipelineContext } from "../pipeline.js";
import type { ThreadContext } from "../index.js";
import type { ContextWindow } from "../../../executable/windows/_shared/types.js";

export const SystemProcessor: PipelinePhase = {
  name: "SystemProcessor",
  run(_thread: ThreadContext, _ctx: PipelineContext): ContextWindow[] {
    // No-op for now: protocol knowledge still produced by synthesizer.collectExecutableKnowledgeEntries.
    // TODO(P5-migration): extract Phase 1 protocol logic from synthesizer.ts and call here.
    return [];
  },
};

/** Re-export the old synthesizer entry point for backward compatibility. */
export { collectExecutableKnowledgeEntries } from "../../knowledge/synthesizer.js";
