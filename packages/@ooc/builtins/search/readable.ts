import { type RenderContext } from "@ooc/core/extendable/_shared/registry.js";
import type { SearchWindow } from "./types.js";
import { xmlElement, xmlText, type XmlNode } from "@ooc/core/thinkable/context/xml.js";
import {
  applyTranscriptViewport,
  type TranscriptViewport,
} from "@ooc/core/extendable/_shared/transcript-viewport.js";
import { DEFAULT_RESULTS_VIEWPORT } from "./executable/results-viewport.js";

export function readable(ctx: RenderContext): XmlNode[] {
  const window = ctx.window as SearchWindow;
  const children: XmlNode[] = [
    xmlElement("kind", {}, [xmlText(window.kind)]),
    xmlElement("query", {}, [xmlText(window.query)]),
  ];
  if (window.searchRoot) {
    children.push(xmlElement("search_root", {}, [xmlText(window.searchRoot)]));
  }

  // 展示状态从 window.state 读，向后兼容旧平铺字段。
  const viewport: TranscriptViewport =
    window.state?.resultsViewport ?? window.resultsViewport ?? DEFAULT_RESULTS_VIEWPORT;
  const { visible, earlierCount } = applyTranscriptViewport(
    window.matches,
    viewport,
  );

  const viewportAttrs: Record<string, string> = {
    total: String(window.matches.length),
  };
  if (typeof viewport.tail === "number") {
    viewportAttrs.tail = String(viewport.tail);
  } else if (
    typeof viewport.rangeStart === "number" &&
    typeof viewport.rangeEnd === "number"
  ) {
    viewportAttrs.matches_start = String(viewport.rangeStart);
    viewportAttrs.matches_end = String(viewport.rangeEnd);
  }
  if (earlierCount > 0) {
    viewportAttrs.earlier_omitted = String(earlierCount);
  }
  children.push(xmlElement("results_viewport", viewportAttrs));

  const matchNodes: XmlNode[] = visible.map((m) => {
    const attrs: Record<string, string> = {
      index: String(m.index),
      path: m.path,
    };
    if (typeof m.line === "number") attrs.line = String(m.line);
    return xmlElement("match", attrs, m.snippet ? [xmlText(m.snippet)] : []);
  });

  children.push(
    xmlElement(
      "matches",
      {
        count: String(window.matches.length),
        truncated: window.truncated ? "true" : "false",
      },
      matchNodes,
    ),
  );
  return children;
}
