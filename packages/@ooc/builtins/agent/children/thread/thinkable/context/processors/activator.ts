/**
 * ActivatorProcessor — matches knowledge frontmatter triggers against thread intents.
 *
 * Produces KnowledgeWindow entries with source="activator".
 */
import type { PipelinePhase, PipelineContext } from "../pipeline.js";
import type { ThreadContext } from "../index.js";
import type { OocObjectRef } from "@ooc/core/runtime/ooc-class.js";
import { buildActivatorKnowledgeWindows } from "../activator-windows.js";

export const ActivatorProcessor: PipelinePhase = {
  name: "ActivatorProcessor",
  async run(thread: ThreadContext, _ctx: PipelineContext): Promise<OocObjectRef[]> {
    return buildActivatorKnowledgeWindows(thread);
  },
};
