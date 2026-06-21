/**
 * interpreter_process — readable 维度（投影成 context window + window method）。
 *
 * - readable：把 Data.history 经投影态 win（history viewport）渲染成进程窗内容。
 * - window method set_history_window：调 history 视口（返回新 win；不碰 Data、不副作用）。
 *
 * history 渲染 + viewport window method 实现见 ./history.ts（本 class 自有）。
 */

import type { ReadableContext, ReadableModule, WindowMethod } from "@ooc/core/readable/contract.js";
import {
  renderProcessHistory,
  setHistoryWindowMethod,
  type ProcessWin,
} from "./history.js";
import type { Data } from "../types.js";

/**
 * window method：调本解释器窗展示档位 compressLevel（compress v2 resize 协议，本 class 自实现）。
 * 0=全文 / 1=缩略 / 2=仅句柄——读出侧 xml.ts:projectByCompressLevel 据此投影输出详略。
 */
const resizeMethod: WindowMethod<Data, ProcessWin> = {
  name: "resize",
  description: "调本解释器窗展示档位 level：0=全输出，1=缩略，2=仅句柄。",
  schema: {
    args: {
      level: { type: "number", required: true, enum: [0, 1, 2], description: "展示档位：0 全文 / 1 缩略 / 2 仅句柄" },
    },
  },
  exec: (_ctx: ReadableContext, _self: Data, before: ProcessWin, args: Record<string, unknown>): ProcessWin => {
    const raw = (args as { level?: number }).level;
    const level = Math.max(0, Math.min(2, typeof raw === "number" ? raw : 0)) as 0 | 1 | 2;
    return { ...before, compressLevel: level };
  },
};

const readable: ReadableModule<Data, ProcessWin> = {
  readable: (_ctx: ReadableContext, self: Data, win: ProcessWin) => ({
    class: "interpreter_process",
    content: renderProcessHistory(self.history, win),
  }),
  window: [
    {
      class: "interpreter_process",
      object_methods: ["exec", "close"],
      window_methods: [setHistoryWindowMethod, resizeMethod],
    },
  ],
};

export default readable;
