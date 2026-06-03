/**
 * PeerProcessor — discovers peer Object windows from the current thread's session.
 *
 * Wraps the existing derivePeerObjectWindows from synthesizer.ts.
 * The old function is NOT removed from synthesizer.ts (backward compat);
 * this processor exposes it as a PipelinePhase.
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

/** Re-export for backward compat with existing importers in synthesizer.ts. */
export { derivePeerObjectWindows };
