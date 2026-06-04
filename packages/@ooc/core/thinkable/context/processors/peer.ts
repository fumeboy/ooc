/**
 * PeerProcessor — discovers peer Object windows from the current thread's session.
 *
 * Wraps derivePeerObjectWindows from synthesizer.ts.
 * Replaces synthesizer.collectExecutableKnowledgeEntries Phase 4.
 */
import type { PipelinePhase, PipelineContext } from "../pipeline.js";
import type { ThreadContext } from "../index.js";
import type { ContextWindow } from "../../../executable/windows/_shared/types.js";
import { derivePeerObjectWindows } from "../../knowledge/synthesizer.js";

export const PeerProcessor: PipelinePhase = {
  name: "PeerProcessor",
  async run(thread: ThreadContext, _ctx: PipelineContext): Promise<ContextWindow[]> {
    return derivePeerObjectWindows(thread);
  },
};
