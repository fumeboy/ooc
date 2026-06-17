/**
 * SystemProcessor — produces protocol knowledge windows + ensures self object type registered.
 *
 * Covers: builtin protocol knowledge（按 activates_on 命中）、creator-reply 协议、self 类型注册。
 * skill_index 不再走本 processor 旁路——它作为 member-window（init.ts）注入，skills 由其 readable
 * 渲染期自算（object-model 核心 4）。
 */
import type { PipelinePhase, PipelineContext } from "../pipeline.js";
import type { ThreadContext } from "../index.js";
import type { OocObjectInstance } from "../../../runtime/ooc-class.js";
import { builtinRegistry } from "@ooc/core/runtime/object-registry.js";
import { buildProtocolKnowledgeWindows } from "../protocol.js";
import { ensureSelfObjectTypeRegistered } from "../object-windows.js";

export const SystemProcessor: PipelinePhase = {
  name: "SystemProcessor",
  async run(thread: ThreadContext, _ctx: PipelineContext): Promise<OocObjectInstance[]> {
    // Ensure self object type is dynamically registered (ooc-6 design)
    await ensureSelfObjectTypeRegistered(thread, builtinRegistry);

    const out: OocObjectInstance[] = [];

    // Protocol knowledge windows
    out.push(...await buildProtocolKnowledgeWindows(thread, builtinRegistry));

    return out;
  },
};
