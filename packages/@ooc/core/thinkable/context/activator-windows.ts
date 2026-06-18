/**
 * Knowledge activator windows.
 *
 * Matches active thread intents against knowledge index frontmatter triggers and produces
 * KnowledgeWindow entries with source="activator".
 */
import { isKnowledgeClass } from "../../_shared/types/constants.js";
import type { OocObjectInstance } from "../../runtime/ooc-class.js";
import type { Data as KnowledgeData } from "@ooc/builtins/knowledge_base/knowledge/types.js";
import type { ThreadContext } from "./index.js";
import { computeActivations } from "../knowledge/activator.js";
import { loadKnowledgeIndex } from "../knowledge/loader.js";
import { deriveStoneFromThread, derivePoolFromThread } from "../../persistable/index.js";
import { makeKnowledgeWindow } from "./knowledge-window.js";

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
      .filter((w) => isKnowledgeClass(w.class) && (w.data as KnowledgeData | undefined)?.source === "explicit")
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
      const body = act.presentation === "full" ? act.doc.body : "";
      out.push(
        makeKnowledgeWindow(act.path, body, "activator", {
          presentation: act.presentation,
          description: act.doc.frontmatter.description,
        }),
      );
    }
    return out;
  } catch {
    return [];
  }
}
