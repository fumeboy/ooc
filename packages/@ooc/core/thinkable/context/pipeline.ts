/**
 * ContextPipeline — staged construction of LLM context from ThreadContext.
 *
 * Phases (lazy cache-aware):
 * 1. IntentCacheReader — read cached intents for each form (no computation)
 * 2. BaseWindowLoader — load persistent context windows
 * 3. Processors[] — SystemProcessor, MethodFormProcessor, KnowledgeProcessor,
 *    ActivatorProcessor, PeerProcessor. Each processor reads from intentCache and
 *    produces derived ContextWindows.
 * 4. BudgetManager — relevance scoring + overflow
 * 5. Renderer selection
 *
 * buildInputItems becomes a thin wrapper around this pipeline.
 */
import type { ThreadContext } from "./index.js";
import type { ContextWindow } from "../../executable/windows/_shared/types.js";
import type { ContextSnapshot } from "./snapshot.js";
import { BudgetManager, loadBudgetThresholds } from "./budget.js";
import { SystemProcessor } from "./processors/system.js";
import { MethodFormProcessor } from "./processors/method.js";
import { KnowledgeProcessor } from "./processors/knowledge.js";
import { ActivatorProcessor } from "./processors/activator.js";
import { PeerProcessor } from "./processors/peer.js";

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

    // Phase 4: BudgetManager.allocate
    const budget = new BudgetManager();
    const thresholds = loadBudgetThresholds(thread);
    const { visible, overflow } = budget.allocate(ctx.windows, thresholds.hard);

    // Build trace from intentCache
    const traceIntents: Record<string, import("./intent.js").Intent[]> = {};
    for (const [formId, entry] of intentCache) {
      traceIntents[formId] = entry.intents;
    }

    return {
      thread: { id: thread.id, status: thread.status },
      self: { objectId: thread.persistence?.objectId ?? "root" },
      windows: visible,
      overflow,
      trace: {
        intents: traceIntents,
        perWindow: {},
      },
    } as ContextSnapshot;
  }
}

/**
 * Default pipeline with standard phase ordering.
 *
 * Ordering:
 * 1. SystemProcessor — protocol knowledge (basics, reflectable, type-level basics,
 *    creator-reply, end-reflection reminder) + skill_index + self-type registration
 * 2. MethodFormProcessor — enrich method_exec forms (effectiveVisibleType,
 *    commandKnowledgePaths) + derive form-scoped knowledge windows
 * 3. KnowledgeProcessor — intent-triggered knowledge from intentCache
 * 4. ActivatorProcessor — traditional frontmatter trigger-based knowledge activation
 * 5. PeerProcessor — peer/children Object windows
 *
 * BudgetManager.allocate runs after all phases inside pipeline.run().
 */
export function createDefaultPipeline(): ContextPipeline {
  const p = new ContextPipeline();
  p.addPhase(SystemProcessor);
  p.addPhase(MethodFormProcessor);
  p.addPhase(KnowledgeProcessor);
  p.addPhase(ActivatorProcessor);
  p.addPhase(PeerProcessor);
  return p;
}
