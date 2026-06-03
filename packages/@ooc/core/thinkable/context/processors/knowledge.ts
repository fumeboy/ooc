/**
 * KnowledgeProcessor — matches knowledge frontmatter triggers against active form intents.
 *
 * For each form in thread.intentCache:
 *   1. Check cache key = (formId, argsHash)
 *   2. If miss: scan knowledge index for activates_on entries matching the form's intents
 *   3. Produce derived ContextWindows with provenance.kind="derived", boundFormId=<formId>
 *
 * Uses the existing trigger infra (parseTrigger / evaluateTrigger) extended in P5e
 * with the new "intent" trigger kind.
 */
import type { PipelinePhase, PipelineContext } from "../pipeline.js";
import type { ThreadContext } from "../index.js";
import type { ContextWindow } from "../../../executable/windows/_shared/types.js";
import type { Intent, IntentCacheEntry } from "../intent.js";
import { evaluateTrigger, parseTrigger, matchesIntentName } from "../../knowledge/triggers.js";
import type { KnowledgeIndex } from "../../knowledge/types.js";
import { computeActivations } from "../../knowledge/activator.js";
import { loadKnowledgeIndex, clearKnowledgeLoaderCache } from "../../knowledge/loader.js";
import { deriveStoneFromThread, derivePoolFromThread } from "../../../persistable/index.js";

/** Per-form processor cache — keyed by (formId, argsHash). */
const processorCache = new Map<string, ContextWindow[]>();

function cacheKey(formId: string, entry: IntentCacheEntry): string {
  return `${formId}|${entry.argsHash}`;
}

function intentTriggerHits(
  formId: string,
  intents: Intent[],
  index: KnowledgeIndex,
): ContextWindow[] {
  const results: ContextWindow[] = [];
  const now = Date.now();
  const activeIntentNames = new Set(intents.map((i) => i.name));

  for (const doc of index.byPath.values()) {
    if (!doc.frontmatter.activates_on) continue;
    for (const [expr, level] of Object.entries(doc.frontmatter.activates_on)) {
      let trigger;
      try {
        trigger = parseTrigger(expr);
      } catch {
        continue;
      }
      if (trigger.kind !== "intent") continue;
      const matched = intents.some((i) => matchesIntentName(i.name, trigger.intentName));
      if (!matched) continue;

      const body = level === "show_content" ? doc.body : doc.frontmatter.description ?? doc.body;
      const hitIntent = intents.find((i) => matchesIntentName(i.name, trigger.intentName));
      // @ts-ignore - KnowledgeWindow has path/source/body fields not on base ContextWindow
      const win: ContextWindow = {
        id: `w_kn_${formId}_${doc.path.replace(/[^a-z0-9]/g, "_")}`,
        type: "knowledge",
        parentWindowId: "root",
        title: doc.frontmatter.title ?? doc.path,
        status: "open",
        createdAt: now,
        path: doc.path,
        source: "activator",
        body,
        boundFormId: formId,
        provenance: {
          kind: "derived",
          reason: {
            mechanism: "intent_match",
            sourceId: hitIntent?.name,
            detail: { trigger: expr, level },
          },
          createdAt: now,
          lastTouchedAt: now,
        },
      };
      results.push(win);
      break; // One activation per doc is enough
    }
  }
  // suppress unused
  void activeIntentNames;
  return results;
}

export const KnowledgeProcessor: PipelinePhase = {
  name: "KnowledgeProcessor",
  async run(thread: ThreadContext, _ctx: PipelineContext): Promise<ContextWindow[]> {
    const out: ContextWindow[] = [];
    const cache: Map<string, IntentCacheEntry> | undefined = (thread as any).intentCache;
    if (!cache || cache.size === 0) return out;

    // Load knowledge index (uses internal caching in loader)
    const persistence = thread.persistence;
    if (!persistence) return out;
    let index: KnowledgeIndex;
    try {
      const stoneRef = deriveStoneFromThread(persistence);
      const poolRef = derivePoolFromThread(persistence);
      index = await loadKnowledgeIndex({ stone: stoneRef, pool: poolRef });
    } catch {
      return out;
    }

    for (const [formId, entry] of cache) {
      const key = cacheKey(formId, entry);
      const cached = processorCache.get(key);
      if (cached) {
        out.push(...cached);
        continue;
      }
      const derived = intentTriggerHits(formId, entry.intents, index);
      processorCache.set(key, derived);
      out.push(...derived);
    }

    // suppress unused (existing computeActivations kept for future)
    void computeActivations;
    void clearKnowledgeLoaderCache;
    void evaluateTrigger;
    return out;
  },
};
