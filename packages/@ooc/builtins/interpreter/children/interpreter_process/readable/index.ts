/**
 * interpreter_process — readable 维度（投影成 context window + window method）。
 *
 * - readable：把 Data.history 经投影态 win（history viewport）渲染成进程窗内容。
 * - window method set_history_window：调 history 视口（返回新 win；不碰 Data、不副作用）。
 *
 * history 渲染 + viewport window method 与 terminal_process 同构，复用 _shared/process-readable。
 */

import type { ReadableContext, ReadableModule } from "@ooc/core/readable/contract.js";
import {
  renderProcessHistory,
  makeSetHistoryWindowMethod,
  type ProcessWin,
} from "@ooc/builtins/_shared/executable/process-readable.js";
import type { Data } from "../types.js";
import { displayResize } from "@ooc/core/readable/display-resize.js";

const readable: ReadableModule<Data, ProcessWin> = {
  readable: (_ctx: ReadableContext, self: Data, win: ProcessWin) => ({
    class: "interpreter_process",
    content: renderProcessHistory(self.history, win),
  }),
  window: [
    {
      class: "interpreter_process",
      object_methods: ["exec", "close"],
      window_methods: [makeSetHistoryWindowMethod("interpreter_process"), displayResize],
    },
  ],
};

export default readable;
