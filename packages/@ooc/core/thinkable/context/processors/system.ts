/**
 * SystemProcessor — produces protocol knowledge windows + ensures self object type registered.
 *
 * Covers: root builtin knowledge（按 activates_on 命中）、creator-reply 协议、skill_index window。
 */
import type { PipelinePhase, PipelineContext } from "../pipeline.js";
import type { ThreadContext } from "../index.js";
import type { OocObjectInstance } from "../../../runtime/ooc-class.js";
import { builtinRegistry } from "@ooc/core/runtime/object-registry.js";
import { buildProtocolKnowledgeWindows } from "../protocol.js";
import { synthesizeSkillIndex } from "../skill-index.js";
import { ensureSelfObjectTypeRegistered } from "../object-windows.js";

export const SystemProcessor: PipelinePhase = {
  name: "SystemProcessor",
  async run(thread: ThreadContext, _ctx: PipelineContext): Promise<OocObjectInstance[]> {
    // Ensure self object type is dynamically registered (ooc-6 design)
    await ensureSelfObjectTypeRegistered(thread, builtinRegistry);

    const out: OocObjectInstance[] = [];

    // Protocol knowledge windows
    out.push(...await buildProtocolKnowledgeWindows(thread, builtinRegistry));

    // Skill index window
    out.push(...await synthesizeSkillIndex(thread));

    return out;
  },
};
