/**
 * interpreter_process — readable 维度（投影成 context window + window method）。
 *
 * - readable：把 Data.history 经投影态 win（history viewport）渲染成进程窗内容。
 * - window method set_history_window：调 history 视口（返回新 win；不碰 Data、不副作用）。
 *
 * history 渲染 + viewport window method 实现见 ./history.ts（本 class 自有）。
 */

import type { ReadableContext, ReadableModule } from "@ooc/core/types";
import type { ReadonlySelfProxy } from "@ooc/core/types";
import {
  renderProcessHistory,
  setHistoryWindowMethod,
  type ProcessWin,
} from "./history.js";
import type { Data } from "../types.js";

import type { OocObjectRef } from "@ooc/core/runtime/ooc-class.js";

const readable: ReadableModule<Data, ProcessWin> = {
  readable: (_ctx: ReadableContext, self: ReadonlySelfProxy<Data>, win: OocObjectRef<ProcessWin>) => ({
    view: "default",
    content: renderProcessHistory(self.data.history, win.data ?? {}),
  }),
  window: [
    {
      view: "default",
      object_methods: ["exec", "close"],
      window_methods: [setHistoryWindowMethod],
    },
  ],
};

export default readable;
