/**
 * Knowledge activator windows.
 *
 * Matches active thread intents against knowledge index frontmatter triggers and produces
 * KnowledgeWindow entries with source="activator".
 */
import { isKnowledgeClass } from "@ooc/core/_shared/types/constants.js";
import type { OocObjectRef } from "@ooc/core/runtime/ooc-class.js";
import { objectDataOf, classOf } from "@ooc/core/_shared/types/context-window.js";
import { getSessionObjectTable } from "@ooc/core/runtime/session-object-table.js";
import type { Data as KnowledgeData } from "@ooc/builtins/knowledge_base/knowledge/types.js";
import type { ThreadContext } from "./index.js";
import { computeActivations } from "@ooc/core/thinkable/knowledge/activator.js";
import { loadKnowledgeIndex } from "@ooc/core/thinkable/knowledge/loader.js";
import { deriveStoneFromThread, derivePoolFromThread } from "@ooc/core/persistable/index.js";
import { makeKnowledgeWindow } from "./knowledge-window.js";

/**
 * Produce activator-matched knowledge windows.
 *
 * Skips any path that already appears as an explicit knowledge_window in the thread.
 */
export async function buildActivatorKnowledgeWindows(
  thread: ThreadContext,
): Promise<OocObjectRef<KnowledgeData>[]> {
  if (!thread.persistence) return [];

  const table = getSessionObjectTable(thread);
  const explicitPaths = new Set(
    (thread.contextWindows ?? [])
      .filter((w) => isKnowledgeClass(classOf(w)) && (objectDataOf(w, table) as KnowledgeData | undefined)?.source === "explicit")
      .map((w) => (objectDataOf(w, table) as KnowledgeData).path),
  );

  try {
    const stoneRef = deriveStoneFromThread(thread.persistence);
    const poolRef = derivePoolFromThread(thread.persistence);
    const index = await loadKnowledgeIndex({ stone: stoneRef, pool: poolRef });
    const activations = computeActivations(thread, index);

    const out: OocObjectRef<KnowledgeData>[] = [];
    for (const act of activations) {
      if (explicitPaths.has(act.path)) continue;
      const body = act.presentation === "full" ? act.doc.body : "";
      out.push(
        makeKnowledgeWindow(thread, act.path, body, "activator", {
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
