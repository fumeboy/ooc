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

import { deriveStoneFromThread, discoverStoneHierarchicalPeers, readReadable, readSelf } from "../../persistable/index.js";
import type { ThreadContext } from "../context.js";
import type { ObjectRegistry } from "../../executable/windows/_shared/registry.js";
import { builtinRegistry } from "../../executable/windows/index.js";
import type { ContextWindow, TalkWindow } from "../../executable/windows/_shared/types.js";
import { SUPER_ALIAS_TARGET } from "../../executable/windows/_shared/super-constants.js";
import { loadObjectWindow } from "../../runtime/server-loader.js";
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
