/**
 * PeerProcessor — discovers peer Object windows from the current thread's session.
 *
 * Wraps derivePeerObjectWindows from context/object-windows.ts.
 */
import type { PipelinePhase, PipelineContext } from "../pipeline.js";
import type { ThreadContext } from "../index.js";
import type { OocObjectInstance } from "../../../runtime/ooc-class.js";
import { derivePeerObjectWindows } from "../object-windows.js";

export const PeerProcessor: PipelinePhase = {
  name: "PeerProcessor",
  async run(thread: ThreadContext, _ctx: PipelineContext): Promise<OocObjectInstance[]> {
    return derivePeerObjectWindows(thread);
  },
};
