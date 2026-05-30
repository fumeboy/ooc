/**
 * base/search/executable — search 原型的 behavior 真源（OOC-4 L4.2）。
 *
 * methods（close/open_match/set_results_window）+ renderXml + basicKnowledge 从
 * windows/search/index.ts 的 registry 入口迁到这里，由活路径沿 base 原型链解析
 * （src/executable/windows/_shared/behavior.ts）。
 *
 * **复用而非 copy**：直接 import 现有 entries + renderSearchWindow + SEARCH_WINDOW_BASIC_KNOWLEDGE，
 * 避免逐字 copy 漂移；行为等价由 _shared/__tests__/behavior.test.ts 守。
 *
 * compressView 是 L4 排除项，仍由 windows/search/index.ts registry-served（不迁链）。
 */

import type { ObjectWindowDefinition } from "../../../../executable/server/window-types.js";
import {
  closeCommand,
  openMatchCommand,
  renderSearchWindow,
  SEARCH_WINDOW_BASIC_KNOWLEDGE,
} from "../../../../executable/windows/search/index.js";
import { setResultsWindowCommandForSearch } from "../../../../executable/windows/search/command.set-results-window.js";

export const window: ObjectWindowDefinition = {
  methods: {
    close: closeCommand,
    open_match: openMatchCommand,
    set_results_window: setResultsWindowCommandForSearch,
  },
  renderXml: renderSearchWindow,
  basicKnowledge: SEARCH_WINDOW_BASIC_KNOWLEDGE,
};
