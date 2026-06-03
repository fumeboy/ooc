import type { ContextSnapshot } from "../snapshot.js";
import type { XmlNode } from "../xml.js";
import { serializeXml } from "../xml.js";
import { renderContextXml } from "../render.js";

/**
 * XmlRenderer — renders a ContextSnapshot to the XML format used by the LLM.
 *
 * P6 (2026-06-03): Initial implementation. Currently delegates to the existing
 * renderContextXml function; future iterations will render from the snapshot
 * directly, eliminating the string-round-trip.
 *
 * The `<context_overflow>` section is a new addition over the legacy renderer.
 */
export class XmlRenderer {
  async render(snapshot: ContextSnapshot, thread: any): Promise<string> {
    // Delegate to legacy renderer for the main body
    const legacyXml = await renderContextXml({
      thread,
      contextWindows: snapshot.windows,
    });

    if (snapshot.overflow.length === 0) return legacyXml;

    // Build <context_overflow> appendix
    const overflowNodes: XmlNode[] = snapshot.overflow.map(o => ({
      kind: "element",
      tag: "item",
      attrs: {
        id: o.id,
        title: o.title,
        relevance: o.relevance.toFixed(2),
        reason: o.reason,
      },
    }));

    const overflowNode: XmlNode = {
      kind: "element",
      tag: "context_overflow",
      attrs: {
        item_count: String(snapshot.overflow.length),
      },
      children: overflowNodes,
    };

    // Inject overflow before closing </context> tag
    const overflowStr = serializeXml(overflowNode);
    return legacyXml.replace("</context>", `${overflowStr}\n</context>`);
  }
}

/** @deprecated Use the XmlRenderer class instead. */
export async function renderSnapshotToXml(snapshot: ContextSnapshot, thread: any): Promise<string> {
  return new XmlRenderer().render(snapshot, thread);
}
