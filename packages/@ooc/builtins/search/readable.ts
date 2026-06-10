import { builtinRegistry, type RenderContext } from "@ooc/core/extendable/_shared/registry.js";
import type { SearchWindow } from "./types.js";
import { xmlElement, xmlText, type XmlNode } from "@ooc/core/_shared/types/xml.js";
import {
  applyTranscriptViewport,
  type TranscriptViewport,
} from "@ooc/core/extendable/_shared/transcript-viewport.js";
import {
  DEFAULT_RESULTS_VIEWPORT,
  searchSetResultsViewport,
  hasAnyResultsViewportField,
} from "./executable/results-viewport.js";
import type { WindowMethod } from "@ooc/core/_shared/types/window-method.js";

const SEARCH_PREVIEW_COUNT = 3;
const SEARCH_SNIPPET_TRUNCATE = 200;

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

const setResultsWindowCommandForSearch: WindowMethod = {
  kind: "window",
  description: "Adjust which portion of the search matches are rendered (tail N or fixed range).",
  intents: ["set_results_window"],
  schema: {
    args: {
      matches_tail: { type: "number", description: "Show last N matches (positive integer; mutually exclusive with matches_start/matches_end)" },
      matches_start: { type: "number", description: "Start of range (non-negative integer; must pair with matches_end)" },
      matches_end: { type: "number", description: "End of range (non-negative integer; must pair with matches_start)" },
    },
  },
  onFormChange(change, { args }) {
    let tip = "set_results_window 需要 matches_tail 或 matches_start+matches_end 之一。";
    if (hasAnyResultsViewportField(args)) {
      tip = "参数已就绪，submit 应用视口调整。";
    }
    return { tip, intents: [{ name: "set_results_window" }], quick_exec_submit: hasAnyResultsViewportField(args) };
  },
  exec: (ctx) => searchSetResultsViewport(ctx),
};

/**
 * search_window 的 compressView hook（design §4.1）。
 * - Level 1 (folded):  kind + query + matches.count + 前 3 条 match 预览(仅 path + line)
 * - Level 2 (snapshot): kind + query + matches.count
 */
function compressSearchWindow(ctx: RenderContext, level: 1 | 2): XmlNode[] {
  const window = ctx.window as SearchWindow;
  const children: XmlNode[] = [
    xmlElement("kind", {}, [xmlText(window.kind)]),
    xmlElement("query", {}, [xmlText(window.query)]),
    xmlElement("matches", {
      count: String(window.matches.length),
      truncated: window.truncated ? "true" : "false",
    }),
  ];
  if (level === 1 && window.matches.length > 0) {
    const previewNodes: XmlNode[] = window.matches
      .slice(0, SEARCH_PREVIEW_COUNT)
      .map((m) => {
        const attrs: Record<string, string> = {
          index: String(m.index),
          path: m.path,
        };
        if (typeof m.line === "number") attrs.line = String(m.line);
        const snippet = m.snippet ? m.snippet.slice(0, SEARCH_SNIPPET_TRUNCATE) : undefined;
        return xmlElement("preview", attrs, snippet ? [xmlText(snippet)] : []);
      });
    children.push(xmlElement("preview_list", {}, previewNodes));
  }
  children.push(
    xmlElement("compressed", {
      level: String(level),
      hint: "exec(window_id, 'expand') to restore",
    }),
  );
  return children;
}

// readable 维度自注册（readable + window method set_results_window + compressView + basicKnowledge）。
builtinRegistry.registerReadable("search", {
  windowMethods: {
    set_results_window: setResultsWindowCommandForSearch,
  },
  readable,
  compressView: compressSearchWindow,
});
