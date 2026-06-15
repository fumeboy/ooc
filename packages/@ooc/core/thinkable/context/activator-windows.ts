/**
 * Knowledge activator windows.
 *
 * Matches active thread intents against knowledge index frontmatter triggers and produces
 * KnowledgeWindow entries with source="activator".
 */
import { ROOT_WINDOW_ID } from "../../_shared/types/context-window.js";
import type { OocObjectInstance } from "../../runtime/ooc-class.js";
import type { Data as KnowledgeData } from "@ooc/builtins/knowledge/types.js";
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
): Promise<OocObjectInstance<KnowledgeData>[]> {
  if (!thread.persistence) return [];

  const explicitPaths = new Set(
    (thread.contextWindows ?? [])
      .filter((w) => w.class === "knowledge" && (w.data as KnowledgeData | undefined)?.source === "explicit")
      .map((w) => (w.data as KnowledgeData).path),
  );

  try {
    const stoneRef = deriveStoneFromThread(thread.persistence);
    const poolRef = derivePoolFromThread(thread.persistence);
    const index = await loadKnowledgeIndex({ stone: stoneRef, pool: poolRef });
    const activations = computeActivations(thread, index);

    const out: OocObjectInstance<KnowledgeData>[] = [];
    for (const act of activations) {
      if (explicitPaths.has(act.path)) continue;
      const body = act.presentation === "full" ? truncateKnowledgeBody(act.doc.body) : "";
      out.push({
        id: nextSyntheticId(),
        class: "knowledge",
        parentObjectId: ROOT_WINDOW_ID,
        title: act.path,
        status: "open",
        createdAt: Date.now(),
        data: {
          path: act.path,
          source: "activator",
          body,
          presentation: act.presentation,
          description: act.doc.frontmatter.description,
        },
      });
    }
    return out;
  } catch {
    return [];
  }
}
