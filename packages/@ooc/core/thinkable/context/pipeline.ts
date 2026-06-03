/**
 * ContextPipeline — staged construction of LLM context from ThreadContext.
 *
 * Phases (lazy cache-aware):
 * 1. IntentCacheReader — read cached intents for each form (no computation)
 * 2. BaseWindowLoader — load persistent context windows
 * 3. Processors[] — KnowledgeProcessor (declarative), MethodFormProcessor (onFormChange),
 *    PeerProcessor, SystemProcessor. Each processor reads from intentCache and produces
 *    derived ContextWindows; results cached per (formId, argsHash).
 * 4. BudgetManager — relevance scoring + overflow
 * 5. Renderer selection
 *
 * buildInputItems becomes a thin wrapper around this pipeline.
 */
import type { ThreadContext } from "./index.js";
import type { ContextWindow } from "../../executable/windows/_shared/types.js";
import type { ContextSnapshot } from "./snapshot.js";

export interface PipelinePhase {
  name: string;
  run(thread: ThreadContext, ctx: PipelineContext): ContextWindow[] | Promise<ContextWindow[]>;
}

export interface PipelineContext {
  intentCache: import("./intent.js").IntentCache;
  windows: ContextWindow[];  // accumulated so far
}

export class ContextPipeline {
  private phases: PipelinePhase[] = [];

  addPhase(phase: PipelinePhase): void {
    this.phases.push(phase);
  }

  async run(thread: ThreadContext): Promise<ContextSnapshot> {
    // Ensure thread.intentCache exists (lazy-init)
    const intentCache = (thread as any).intentCache ?? new Map<string, any>();
    if (!(thread as any).intentCache) {
      (thread as any).intentCache = intentCache;
    }
    const ctx: PipelineContext = { intentCache, windows: [...(thread.contextWindows ?? [])] };

    for (const phase of this.phases) {
      const result = await phase.run(thread, ctx);
      if (result && result.length > 0) {
        ctx.windows.push(...result);
      }
    }

    return {
      thread: { id: thread.id, status: thread.status },
      self: { objectId: thread.persistence?.objectId ?? "root" },
      windows: ctx.windows,
      overflow: [],
      trace: { intents: {}, perWindow: {} },
    } as ContextSnapshot;
  }
}

/**
 * Default pipeline with standard phase ordering.
 * Skill index synthesis is NOT included here (kept in old synthesizer for now).
 */
export function createDefaultPipeline(): ContextPipeline {
  const p = new ContextPipeline();
  // Phase 2: BaseWindowLoader is a no-op — base windows already seeded from thread.contextWindows
  // Phase 3 processors are registered in their own modules
  return p;
}
