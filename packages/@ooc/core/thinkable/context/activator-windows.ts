/**
 * Knowledge activator windows — extracted from synthesizer.collectExecutableKnowledgeEntries Phase 3.
 *
 * Matches active thread intents against knowledge index frontmatter triggers and produces
 * KnowledgeWindow entries with source="activator".
 */
import type { ContextWindow, KnowledgeWindow } from "../../executable/windows/_shared/types.js";
import { ROOT_WINDOW_ID } from "../../executable/windows/_shared/types.js";
import type { ThreadContext } from "./index.js";
import { computeActivations } from "../knowledge/activator.js";
import { loadKnowledgeIndex } from "../knowledge/loader.js";
import { deriveStoneFromThread, derivePoolFromThread } from "../../persistable/index.js";

const KNOWLEDGE_BODY_BYTES = 8192;

/** 8KB truncation shared with the renderer. */
function truncateKnowledgeBody(body: string): string {
  const bytes = new TextEncoder().encode(body);
  if (bytes.length <= KNOWLEDGE_BODY_BYTES) return body;
  const head = new TextDecoder().decode(bytes.slice(0, KNOWLEDGE_BODY_BYTES));
  return `${head}...[truncated, original ${bytes.length} bytes]`;
}

let syntheticIdCounter = 0;
function nextSyntheticId(): string {
  syntheticIdCounter += 1;
  return `kn_${Date.now().toString(36)}_${syntheticIdCounter.toString(36)}`;
}

/**
 * Produce activator-matched knowledge windows.
 *
 * Skips any path that already appears as an explicit knowledge_window in the thread.
 */
export async function buildActivatorKnowledgeWindows(
  thread: ThreadContext,
): Promise<ContextWindow[]> {
  if (!thread.persistence) return [];

  const explicitPaths = new Set(
    (thread.contextWindows ?? [])
      .filter((w): w is KnowledgeWindow => w.type === "knowledge" && w.source === "explicit")
      .map((w) => w.path),
  );

  try {
    const stoneRef = deriveStoneFromThread(thread.persistence);
    const poolRef = derivePoolFromThread(thread.persistence);
    const index = await loadKnowledgeIndex({ stone: stoneRef, pool: poolRef });
    const activations = computeActivations(thread, index);

    const out: ContextWindow[] = [];
    for (const act of activations) {
      if (explicitPaths.has(act.path)) continue;
      const body = act.presentation === "full" ? truncateKnowledgeBody(act.doc.body) : "";
      out.push({
        id: nextSyntheticId(),
        type: "knowledge",
        parentWindowId: ROOT_WINDOW_ID,
        title: act.path,
        status: "open",
        createdAt: Date.now(),
        path: act.path,
        source: "activator",
        body,
        presentation: act.presentation,
        description: act.doc.frontmatter.description,
      } as KnowledgeWindow);
    }
    return out;
  } catch {
    return [];
  }
}
