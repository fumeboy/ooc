/**
 * SystemProcessor — produces protocol knowledge windows + ensures self object type registered.
 *
 * Covers: basic type-level knowledge, root commands, reflectable (super-session),
 * creator-reply protocol, end-reflection reminder, and skill_index window.
 *
 * Extracted from synthesizer.collectExecutableKnowledgeEntries Phase 1/1.5/1.5.1/1.6.
 */
import type { PipelinePhase, PipelineContext } from "../pipeline.js";
import type { ThreadContext } from "../index.js";
import type { ContextWindow } from "../../../executable/windows/_shared/types.js";
import { builtinRegistry } from "../../../executable/windows/index.js";
import { buildProtocolKnowledgeWindows } from "../protocol.js";
import { synthesizeSkillIndex, getSkillIndexBasicPath } from "../skill-index.js";
import { ensureSelfObjectTypeRegistered } from "../../knowledge/synthesizer.js";

export const SystemProcessor: PipelinePhase = {
  name: "SystemProcessor",
  async run(thread: ThreadContext, _ctx: PipelineContext): Promise<ContextWindow[]> {
    // Ensure self object type is dynamically registered (ooc-6 design)
    await ensureSelfObjectTypeRegistered(thread, builtinRegistry);

    const out: ContextWindow[] = [];

    // Protocol knowledge windows
    out.push(...buildProtocolKnowledgeWindows(thread, builtinRegistry));

    // Skill index window
    const skillIndex = await synthesizeSkillIndex(thread);
    out.push(...skillIndex);

    // If skill_index was injected, also inject its type-level basicKnowledge
    if (skillIndex.length > 0) {
      try {
        const def = builtinRegistry.getObjectDefinition("skill_index");
        if (def.basicKnowledge) {
          const path = getSkillIndexBasicPath();
          const alreadyPresent = out.some(
            (w) => w.type === "knowledge" && (w as any).path === path,
          );
          if (!alreadyPresent) {
            out.push({
              id: `kn_skill_idx_basic_${Date.now().toString(36)}`,
              type: "knowledge",
              parentWindowId: "root",
              title: path,
              status: "open",
              createdAt: Date.now(),
              path,
              source: "protocol",
              body: def.basicKnowledge,
            } as any);
          }
        }
      } catch { /* skip */ }
    }

    return out;
  },
};
