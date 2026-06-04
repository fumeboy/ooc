/**
 * Backward-compat shim for renderContextXml (Phase F cleanup).
 *
 * The actual rendering logic has moved to XmlRenderer in renderers/xml.ts.
 * This file provides a thin wrapper so existing callers (mostly tests) keep working.
 * New code should import XmlRenderer directly from context/renderers/xml or context/index.
 */
import type { ContextWindow } from "../../executable/windows/_shared/types.js";
import type { ThreadContext } from "./index.js";
import { XmlRenderer } from "./renderers/xml.js";
import type { ContextSnapshot } from "./snapshot.js";
import { builtinRegistry } from "../../executable/windows/index.js";

/**
 * @deprecated Use XmlRenderer.render(snapshot, thread) instead.
 * This wrapper builds a minimal ContextSnapshot from the provided windows.
 */
export async function renderContextXml(input: {
  thread: ThreadContext;
  contextWindows: ContextWindow[] | undefined;
  knowledgeEntries?: Record<string, string>;
  registry?: typeof builtinRegistry;
}): Promise<string> {
  const reg = input.registry ?? builtinRegistry;
  const renderer = new XmlRenderer(reg);
  const windows = input.contextWindows ?? input.thread.contextWindows ?? [];
  const snapshot: ContextSnapshot = {
    thread: { id: input.thread.id, status: input.thread.status },
    self: { objectId: input.thread.persistence?.objectId ?? "root" },
    windows,
    overflow: [],
    trace: { intents: {}, perWindow: {} },
  };
  return renderer.render(snapshot, input.thread);
}

export { escapeXml } from "./xml";
