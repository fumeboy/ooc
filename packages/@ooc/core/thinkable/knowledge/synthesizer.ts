/**
 * Knowledge synthesizer utilities.
 *
 * Phase F (2026-06-04): The main entry point collectExecutableKnowledgeEntries has been
 * decomposed into the ContextPipeline processor chain. What remains here are standalone
 * utilities still used by other parts of the system:
 *
 * - ensureSelfObjectTypeRegistered: dynamic stone-backed object type registration
 *   (used by SystemProcessor in the pipeline)
 * - derivePeerObjectWindows: peer/children Object auto-injection as context windows
 *   (used by PeerProcessor in the pipeline)
 * - readSelfPrototype: reads prototype field from self.md frontmatter
 *
 * The old logic has been extracted to:
 * - thinkable/context/protocol.ts: protocol knowledge windows
 * - thinkable/context/window-enrichment.ts: form enrichment + knowledge derivation
 * - thinkable/context/skill-index.ts: skill index synthesis
 * - thinkable/context/activator-windows.ts: activator-based knowledge windows
 */

import { deriveStoneFromThread, derivePoolFromThread, discoverStoneHierarchicalPeers, listBranchSkills, listObjectSkills, listExternalSkills, readPoolRelation, readFlowRelation, readReadable, readSelf, readableFile, readWorldConfig } from "../../persistable/index.js";
import type { ThreadContext } from "../context.js";
import type { MethodKnowledgeEntries } from "../../executable/windows/_shared/command-types.js";
import type { ObjectRegistry } from "../../executable/windows/_shared/registry.js";
import { builtinRegistry } from "../../executable/windows/index.js";
import type { ContextWindow, TalkWindow } from "../../executable/windows/_shared/types.js";
import { SUPER_ALIAS_TARGET } from "../../executable/windows/_shared/super-constants.js";
import { loadObjectWindow } from "../../executable/server/loader.js";
import type { ObjectWindowDefinition } from "../../executable/server/window-types.js";
import { parseKnowledgeFile } from "./parser.js";

// ── Re-exports moved to window-enrichment.ts (kept for importer stability) ──
export {
  computeFormKnowledgeEntries,
  enrichFormMethodKnowledge,
} from "../context/window-enrichment.js";

// ── readSelfPrototype (P6.§7) ──────────────────────────────────────────────

/**
 * P6.§7 (2026-06-02): Read prototype field from self.md frontmatter
 * (@deprecated alias for parentClass). Returns undefined if missing.
 */
export async function readSelfPrototype(stoneRef: { baseDir: string; objectId: string }): Promise<string | undefined> {
  try {
    const selfText = await readSelf(stoneRef);
    if (!selfText) return undefined;
    const { frontmatter } = parseKnowledgeFile(selfText);
    const proto = (frontmatter as Record<string, unknown>).prototype;
    return typeof proto === "string" && proto.trim().length > 0 ? proto.trim() : undefined;
  } catch {
    return undefined;
  }
}

// ── ensureSelfObjectTypeRegistered ─────────────────────────────────────────

/**
 * Dynamically register the thread's self object type (stone-backed).
 *
 * ooc-6 design: thread.persistence.objectId holds the thread's self window type,
 * but the builtin registry doesn't know stone object types — must be loaded and
 * registered before rendering. Peer types are handled by derivePeerObjectWindows.
 *
 * Idempotent: returns immediately if already registered.
 */
export async function ensureSelfObjectTypeRegistered(
  thread: ThreadContext,
  registry: ObjectRegistry = builtinRegistry,
): Promise<void> {
  const selfId = thread.persistence?.objectId;
  if (!selfId || selfId === "user") return;
  const registeredTypes = registry.listRegisteredObjectTypes();
  if (registeredTypes.includes(selfId as any)) return;
  try {
    const stoneRef = { baseDir: thread.persistence!.baseDir, objectId: selfId };
    const objWin: ObjectWindowDefinition | undefined = await loadObjectWindow(stoneRef);
    const frontmatterPrototype = await readSelfPrototype(stoneRef);
    const parentClass: string | null | undefined =
      objWin?.parentClass !== undefined ? objWin.parentClass :
      objWin?.prototype !== undefined ? objWin.prototype :
      frontmatterPrototype;
    const mergedMethods = { ...(objWin?.methods ?? {}), ...(objWin?.commands ?? {}) };
    registry.registerNewObjectType(selfId as any, {
      methods: mergedMethods,
      renderXml: objWin?.renderXml,
      readable: objWin?.readable,
      onClose: objWin?.onClose,
      basicKnowledge: typeof objWin?.basicKnowledge === "string" ? objWin.basicKnowledge : undefined,
      parentClass,
    });
  } catch (err) {
    console.debug(
      `[self-object] register io_error self=${selfId} msg=${(err as Error).message}`,
    );
    registry.registerNewObjectType(selfId as any, { methods: {} });
  }
}

// ── derivePeerObjectWindows ────────────────────────────────────────────────

/**
 * 2026-05-28 ooc-6 Phase 6: Derive peer/children Object windows.
 *
 * Replacement for the old relation_window mechanism: peer/children OOC Objects
 * themselves enter the context as windows (type=peerId).
 *
 * Mechanism:
 * 1. Collect interacted peers from talk_window(target=peerId)
 * 2. Collect default visible siblings + level-1 children from stone hierarchy
 * 3. Create a window per peer with type=peerId, id=peerId
 * 4. Dynamically register each peer's type in the registry
 */
export async function derivePeerObjectWindows(
  thread: ThreadContext,
  registry: ObjectRegistry = builtinRegistry,
): Promise<ContextWindow[]> {
  if (!thread.persistence) return [];
  const { baseDir, sessionId, objectId: selfId } = thread.persistence;

  // 1) From talk_window
  const talkWindows = (thread.contextWindows ?? []).filter(
    (w): w is TalkWindow => w.type === "talk",
  );
  const peerEarliest = new Map<string, number>();
  for (const w of talkWindows) {
    if (!w.target) continue;
    if (w.target === SUPER_ALIAS_TARGET) continue;
    if (w.target === "user") continue;
    const prev = peerEarliest.get(w.target);
    if (prev === undefined || w.createdAt < prev) peerEarliest.set(w.target, w.createdAt);
  }

  // 2) Default adjacent agents (sibling + level-1 children)
  if (selfId !== "user") {
    try {
      const { siblings, children } = await discoverStoneHierarchicalPeers(
        deriveStoneFromThread(thread.persistence),
      );
      const now = Date.now();
      for (const peer of [...siblings, ...children]) {
        if (peer === selfId) continue;
        if (peer === "user") continue;
        if (!peerEarliest.has(peer)) peerEarliest.set(peer, now);
      }
    } catch (err) {
      console.debug(
        `[peer-objects] hierarchical peers io_error self=${selfId} msg=${(err as Error).message}`,
      );
    }
  }

  if (peerEarliest.size === 0) return [];

  const out: ContextWindow[] = [];
  for (const [peerId, createdAt] of peerEarliest) {
    let title = `peer: ${peerId}`;
    try {
      const peerStoneRef = { baseDir, objectId: peerId };
      const readme = await readReadable(peerStoneRef);
      if (readme) {
        const frontmatterMatch = readme.match(/^---\n([\s\S]*?)\n---/);
        if (frontmatterMatch) {
          const titleMatch = frontmatterMatch[1].match(/^title:\s*(.+)$/m);
          if (titleMatch) title = titleMatch[1].trim();
        }
      }

      const objWin: ObjectWindowDefinition | undefined = await loadObjectWindow(peerStoneRef);
      const registeredTypes = registry.listRegisteredObjectTypes();
      if (!registeredTypes.includes(peerId as any) && objWin) {
        const frontmatterPrototype = await readSelfPrototype(peerStoneRef);
        const parentClass: string | null | undefined =
          objWin.parentClass !== undefined ? objWin.parentClass :
          objWin.prototype !== undefined ? objWin.prototype :
          frontmatterPrototype;
        const mergedMethods = { ...(objWin.methods ?? {}), ...(objWin.commands ?? {}) };
        registry.registerNewObjectType(peerId as any, {
          methods: mergedMethods,
          renderXml: objWin.renderXml,
          readable: objWin.readable,
          onClose: objWin.onClose,
          basicKnowledge: typeof objWin.basicKnowledge === "string" ? objWin.basicKnowledge : undefined,
          parentClass,
        });
      }
    } catch {
      // ignore
    }

    out.push({
      id: peerId,
      type: peerId as any,
      parentWindowId: "root",
      title,
      status: "open",
      createdAt,
    } as ContextWindow);
  }

  return out;
}

// ── Backward-compat shims (Phase F; tests use these) ────────────────────────

import { createDefaultPipeline } from "../context/pipeline.js";
import { buildProtocolKnowledgeWindows, collectProtocolEntries } from "../context/protocol.js";
import { enrichContextWindows } from "../context/window-enrichment.js";
import { synthesizeSkillIndex, mergeSkillIndex } from "../context/skill-index.js";
import { buildActivatorKnowledgeWindows } from "../context/activator-windows.js";
import { getSkillIndexBasicPath } from "../context/skill-index.js";

/**
 * @deprecated Phase F — use ContextPipeline (createDefaultPipeline().run(thread)) instead.
 *
 * Backward-compat shim: replicates the old collectExecutableKnowledgeEntries behavior
 * by running the same processor chain used by ContextPipeline.
 * Used exclusively by existing tests.
 */
export async function collectExecutableKnowledgeEntries(
  contextWindows: ContextWindow[] | undefined,
  thread: ThreadContext,
  registry: ObjectRegistry = builtinRegistry,
): Promise<{ contextWindows: ContextWindow[] | undefined; knowledgeEntries: MethodKnowledgeEntries }> {
  // Ensure self type registered
  await ensureSelfObjectTypeRegistered(thread, registry);

  // Step 1: enrich windows (effectiveVisibleType + form knowledge)
  const threadForEnrich: ThreadContext = { ...thread, contextWindows: contextWindows ?? [] };
  const { enrichedWindows, formKnowledgeEntries } = await enrichContextWindows(
    contextWindows,
    threadForEnrich,
    registry,
  );

  // Step 2: protocol knowledge
  const protocolWindows = buildProtocolKnowledgeWindows(threadForEnrich, registry);

  // Step 3: skill index
  const skillIndex = await synthesizeSkillIndex(thread);
  const withSkill = mergeSkillIndex([...enrichedWindows, ...protocolWindows], skillIndex);

  // Step 3b: skill_index basicKnowledge (if skill_index was injected)
  if (skillIndex.length > 0) {
    try {
      const def = registry.getObjectDefinition("skill_index");
      if (def.basicKnowledge) {
        const path = getSkillIndexBasicPath();
        const hasAlready = withSkill.some(
          (w) => w.type === "knowledge" && (w as any).path === path,
        );
        if (!hasAlready) {
          withSkill.push({
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

  // Step 4: activator windows
  const activatorWindows = await buildActivatorKnowledgeWindows(threadForEnrich);

  // Step 5: peer windows
  const peerWindows = await derivePeerObjectWindows(threadForEnrich, registry);

  // Merge all
  const finalWindows = [...withSkill, ...activatorWindows, ...peerWindows];

  // Build knowledgeEntries map (for backward compat)
  const entries: MethodKnowledgeEntries = { ...collectProtocolEntries(threadForEnrich, registry) };
  for (const [k, v] of Object.entries(formKnowledgeEntries)) {
    if (!(k in entries)) entries[k] = v;
  }

  return { contextWindows: finalWindows, knowledgeEntries: entries };
}

// suppress unused imports for lint
void createDefaultPipeline;
void deriveStoneFromThread;
void derivePoolFromThread;
void listBranchSkills;
void listObjectSkills;
void listExternalSkills;
void readPoolRelation;
void readFlowRelation;
void readableFile;
void readWorldConfig;

// ── Deprecated relation-window stubs (Phase F cleanup; kept for test compat) ──

import type {
  KnowledgeWindow,
  RelationWindow,
} from "../../executable/windows/_shared/types.js";

/**
 * @deprecated 2026-05-28 ooc-6 Phase 6: Replaced by derivePeerObjectWindows.
 * Relation windows are no longer used; peer Objects themselves enter context as windows.
 * Kept as an empty-array stub for existing test compatibility.
 */
export async function deriveRelationWindow(
  _thread: ThreadContext,
): Promise<RelationWindow[]> {
  return [];
}

/**
 * @deprecated 2026-05-21: Empty backward-compat shim.
 */
export async function deriveRelationCompanionKnowledge(
  _thread: ThreadContext,
): Promise<KnowledgeWindow[]> {
  return [];
}

/**
 * @deprecated 2026-05-21: Alias for deriveRelationCompanionKnowledge, empty shim.
 */
export async function deriveRelationKnowledge(
  _thread: ThreadContext,
): Promise<KnowledgeWindow[]> {
  return [];
}
