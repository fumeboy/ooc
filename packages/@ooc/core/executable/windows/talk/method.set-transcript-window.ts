/**
 * talk_window.set_transcript_window — transcript 渲染窗口调整（WindowMethod）。
 */

import type { WindowMethod } from "../../../_shared/types/window-method.js";
import type { MethodExecWindow } from "../method_exec/types.js";
import {
  windowSetTranscriptViewport,
  hasAnyTranscriptViewportField,
} from "../_shared/transcript-viewport.js";

const SET_TRANSCRIPT_TIP = `set_transcript_window 调整 transcript 渲染窗口。
参数（择一）：tail（末 N 条）或 range_start+range_end（固定区间）。`;

export const setTranscriptWindowCommandForTalk: WindowMethod = {
  kind: "window",
  description: "Adjust which portion of the transcript is rendered (tail N or fixed range).",
  intents: ["set_transcript_window"],
  schema: {
    args: {
      tail: { type: "number", required: false, description: "末 N 条（正整数，与 range_* 互斥）" },
      range_start: { type: "number", required: false, description: "区间起点" },
      range_end: { type: "number", required: false, description: "区间终点" },
    },
  },
  onFormChange(change, { form }) {
    const args = (form as MethodExecWindow).accumulatedArgs;
    const ready = hasAnyTranscriptViewportField(args);
    return {
      tip: ready ? "Updating transcript viewport..." : SET_TRANSCRIPT_TIP,
      intents: [{ name: "set_transcript_window" }],
      quick_exec_submit: ready,
    };
  },
  exec: (ctx) => windowSetTranscriptViewport(ctx, ["talk"]),
};
