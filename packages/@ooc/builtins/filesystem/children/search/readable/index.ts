/**
 * search —— readable 维度（投影成 context window + window method）。
 *
 * - readable：把 Data 投影成 search window —— kind + query + searchRoot + matches（经
 *   matches viewport 切片）。
 * - window method `set_results_window`：只调投影态 `win`（resultsViewport），不碰 Data、不产副作用。
 *
 * 与 executable 维度（object method，在 ../executable/index.ts）物理分离。
 */

import type {
  ReadableContext,
  WindowMethod,
  ReadableModule,
} from "@ooc/core/readable/contract.js";
import {
  DEFAULT_TRANSCRIPT_VIEWPORT,
  applyTranscriptViewport,
  mergeTranscriptViewport,
  type TranscriptViewport,
} from "@ooc/core/_shared/types/viewport.js";
import { xmlElement, xmlText, type XmlNode } from "@ooc/core/_shared/types/xml.js";
import type { Data } from "../types.js";

/** search window 的默认 results viewport：末 50 条 match。 */
export const DEFAULT_RESULTS_VIEWPORT: TranscriptViewport = Object.freeze({
  tail: 50,
});

/** search 的**投影态**（与 Data 分离）：matches 渲染视口（末 N 条 / 固定区间）。 */
export interface SearchWin {
  resultsViewport?: TranscriptViewport;
}

/**
 * set_results_window 字段命名采用 search-specific 前缀 matches_*（与通用 tail / range_* 同结构）：
 *   matches_tail → tail / matches_start → range_start / matches_end → range_end。
 * 内部翻译为通用字段后复用 `mergeTranscriptViewport`（fail-loud + tail/range 互斥）。
 */
const MATCHES_TAIL = "matches_tail";
const MATCHES_START = "matches_start";
const MATCHES_END = "matches_end";

function hasAnyResultsViewportField(args: Record<string, unknown>): boolean {
  return MATCHES_TAIL in args || MATCHES_START in args || MATCHES_END in args;
}

function translateMatchesArgs(
  args: Record<string, unknown>,
): Record<string, unknown> {
  const translated: Record<string, unknown> = {};
  if (MATCHES_TAIL in args) translated.tail = args[MATCHES_TAIL];
  if (MATCHES_START in args) translated.range_start = args[MATCHES_START];
  if (MATCHES_END in args) translated.range_end = args[MATCHES_END];
  return translated;
}

/** window method：调整 matches 渲染视口（返回新 win；不碰 Data）。 */
const setResultsWindowMethod: WindowMethod<Data, SearchWin> = {
  name: "set_results_window",
  description:
    "Adjust which portion of the search matches are rendered (tail N or fixed range).",
  schema: {
    args: {
      matches_tail: {
        type: "number",
        description:
          "Show last N matches (positive integer; mutually exclusive with matches_start/matches_end)",
      },
      matches_start: {
        type: "number",
        description:
          "Start of range (non-negative integer; must pair with matches_end)",
      },
      matches_end: {
        type: "number",
        description:
          "End of range (non-negative integer; must pair with matches_start)",
      },
    },
  },
  exec: (
    _ctx: ReadableContext,
    _self: Data,
    before: SearchWin,
    args: Record<string, unknown>,
  ): SearchWin => {
    const current = before?.resultsViewport ?? DEFAULT_RESULTS_VIEWPORT;
    if (!hasAnyResultsViewportField(args)) {
      // no-op：保持当前视口（fail-soft，对齐旧 adapter 的「字段缺失返回原 state」）
      return { resultsViewport: current };
    }
    const merged = mergeTranscriptViewport(current, translateMatchesArgs(args));
    if (!merged.ok) {
      const msg = merged.error
        .replace(/range_start/g, MATCHES_START)
        .replace(/range_end/g, MATCHES_END)
        .replace(/\btail\b/g, MATCHES_TAIL);
      throw new Error(`[search.set_results_window] ${msg}`);
    }
    return { resultsViewport: merged.viewport };
  },
};

const readable: ReadableModule<Data, SearchWin> = {
  readable: (_ctx: ReadableContext, self: Data, win: SearchWin) => {
    const children: XmlNode[] = [
      xmlElement("kind", {}, [xmlText(self.kind)]),
      xmlElement("query", {}, [xmlText(self.query)]),
    ];
    if (self.searchRoot) {
      children.push(xmlElement("search_root", {}, [xmlText(self.searchRoot)]));
    }

    const viewport: TranscriptViewport =
      win?.resultsViewport ?? DEFAULT_RESULTS_VIEWPORT;
    const { visible, earlierCount } = applyTranscriptViewport(
      self.matches,
      viewport,
    );

    const viewportAttrs: Record<string, string> = {
      total: String(self.matches.length),
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
          count: String(self.matches.length),
          truncated: self.truncated ? "true" : "false",
        },
        matchNodes,
      ),
    );

    return { class: "search", content: children };
  },
  window: [
    {
      class: "search",
      object_methods: ["open_match", "close"],
      window_methods: [setResultsWindowMethod],
    },
  ],
};

export default readable;
