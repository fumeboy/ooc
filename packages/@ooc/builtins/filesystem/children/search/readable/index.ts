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
} from "@ooc/core/types";
import {
  DEFAULT_TRANSCRIPT_VIEWPORT,
  applyTranscriptViewport,
  mergeTranscriptViewport,
  type TranscriptViewport,
} from "./transcript-viewport.js";
import { xmlElement, xmlText, type XmlNode } from "@ooc/core/types/xml.js";
import type { ReadonlySelfProxy } from "@ooc/core/types";
import type { Data } from "../types.js";
import { OocObjectRef } from "@src/runtime/ooc-class.js";

export interface SearchWin {
}


const readable: ReadableModule<Data, SearchWin> = {
  readable: (_ctx: ReadableContext, self: ReadonlySelfProxy<Data>, win: OocObjectRef<SearchWin>) => {
    const children: XmlNode[] = [
      xmlElement("kind", {}, [xmlText(self.data.kind)]),
      xmlElement("query", {}, [xmlText(self.data.query)]),
    ];
    if (self.data.searchRoot) {
      children.push(xmlElement("search_root", {}, [xmlText(self.data.searchRoot)]));
    }
    const matchNodes: XmlNode[] = self.data.matches.map((m) => {
      const attrs: Record<string, string> = {
        index: String(m.index),
        path: m.path,
      };
      if (typeof m.line === "number") {
        attrs.line = String(m.line);
      }
      return xmlElement("match", attrs, m.snippet ? [xmlText(m.snippet)] : []);
    });
    children.push(
      xmlElement(
        "matches",
        {
          count: String(self.data.matches.length),
          truncated: self.data.truncated ? "true" : "false",
        },
        matchNodes,
      ),
    );

    return { class: "default", content: children };
  },
  window: [
    {
      class: "default",
      object_methods: ["open_match"],
      window_methods: [],
    },
  ],
};

export default readable;
