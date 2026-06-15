/**
 * Test helper: behaviour-preserving replacement for the removed
 * `thinkable/context/render` shim's `renderContextXml({ thread, contextWindows })`.
 *
 * The production render path now goes through ContextPipeline + XmlRenderer
 * (snapshot, thread). For tests that only want to render a fixed set of windows
 * (no budget allocation / synthesis), we build a minimal ContextSnapshot directly
 * from the supplied windows and call XmlRenderer.render — keeping the old
 * "given these windows, produce this XML" contract intact.
 */
import { XmlRenderer } from "../thinkable/context/renderers/xml.js";
import type { ContextSnapshot } from "../thinkable/context/snapshot.js";
import type { ThreadContext } from "../thinkable/context/index.js";
import type {
  BaseContextWindow,
  ContextWindow,
} from "@ooc/core/_shared/types/context-window.js";

export async function renderContextXml(input: {
  thread: ThreadContext;
  contextWindows: BaseContextWindow[];
}): Promise<string> {
  const { thread, contextWindows } = input;
  const snapshot: ContextSnapshot = {
    thread: { id: thread.id, status: thread.status },
    self: { objectId: thread.persistence?.objectId ?? "" },
    // batch C narrowing(N4): snapshot.windows 是 union 实例；契约层 contextWindows 是 base[]。
    windows: contextWindows as ContextWindow[],
    overflow: [],
  };
  const renderer = new XmlRenderer();
  return renderer.render(snapshot, thread);
}
