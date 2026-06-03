/**
 * MethodFormProcessor — read-side companion to the manager write path.
 *
 * The actual onFormChange dispatch happens in WindowManager (write path):
 * openCommandExec, refine, and submit fire events and mutate thread.contextWindows
 * directly. This processor is a future-proofing placeholder — when dispatch moves
 * from manager to pipeline, the logic migrates here.
 *
 * For now it validates that each form in intentCache still exists in contextWindows
 * (produces no output windows).
 */
import type { PipelinePhase, PipelineContext } from "../pipeline.js";
import type { ThreadContext } from "../index.js";
import type { ContextWindow } from "../../../executable/windows/_shared/types.js";

export const MethodFormProcessor: PipelinePhase = {
  name: "MethodFormProcessor",
  run(_thread: ThreadContext, _ctx: PipelineContext): ContextWindow[] {
    // No-op: onFormChange dispatch already happened in the manager write path.
    // Future: move dispatch here to centralize form lifecycle handling.
    return [];
  },
};
