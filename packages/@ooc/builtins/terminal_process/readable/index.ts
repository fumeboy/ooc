/**
 * terminal_process — readable 维度（投影成 context window + window method）。
 *
 * - readable：把 Data.history 投影成 terminal_process window（history 按投影态 win 的视口截取）。
 * - window method `set_history_window`：只调投影态 win（historyViewport），不碰 Data、不副作用。
 *
 * history 渲染 + set_history_window 与 interpreter_process 同构，共用 _shared/process-readable。
 * 与 executable 维度（object method，在 ../executable/index.ts）物理分离。
 */

import type {
  ReadableContext,
  ReadableModule,
} from "@ooc/core/readable/contract.js";
import {
  renderProcessHistory,
  makeSetHistoryWindowMethod,
  type ProcessWin,
} from "@ooc/builtins/_shared/executable/process-readable.js";
import type { Data } from "../types.js";

const setHistoryWindowMethod = makeSetHistoryWindowMethod("terminal_process");

const readable: ReadableModule<Data, ProcessWin> = {
  readable: (_ctx: ReadableContext, self: Data, win: ProcessWin) => ({
    class: "terminal_process",
    content: renderProcessHistory(self.history ?? [], win),
  }),
  window: [
    {
      class: "terminal_process",
      object_methods: ["exec", "close"],
      window_methods: [setHistoryWindowMethod],
    },
  ],
};

export default readable;
