/**
 * interpreter_process 的 history 投影 —— readable 投影纯函数 + set_history_window window method。
 *
 * renderProcessHistory 是纯函数 `(history, win) => XmlNode[]`（读 Data.history + 投影态
 * win.historyViewport，不读整窗）；setHistoryWindowMethod 是新契约 WindowMethod
 * `(ctx, self, before_win, args) => 新 win`。用本 class 的 transcript-viewport.ts 纯函数；
 * history_* 前缀在此 remap 到 tail / range_start / range_end。
 */
import { xmlElement, xmlText, xmlComment, truncateBytes, type XmlNode } from "@ooc/core/types/xml.js";
import {
  applyTranscriptViewport,
  mergeTranscriptViewport,
  type TranscriptViewport,
} from "./transcript-viewport.js";
import type { WindowMethod, ReadableContext } from "@ooc/core/types";
import type { ReadonlySelfProxy } from "@ooc/core/types";
import type { Data, ProcessExecRecord } from "../types.js";

/** interpreter_process 窗的投影态（与 Data 分离）：history 视口。 */
export interface ProcessWin {
  historyViewport?: TranscriptViewport;
}

/** 默认 history viewport：末 10 次 exec。 */
export const DEFAULT_HISTORY_VIEWPORT: TranscriptViewport = Object.freeze({ tail: 10 });

/** readable 投影 body：history 摘要（按 viewport 截取）+ 最近一条 full output。 */
export function renderProcessHistory(
  history: ProcessExecRecord[],
  win: ProcessWin | undefined,
): XmlNode[] {
  const children: XmlNode[] = [];
  if (history.length === 0) {
    children.push(xmlComment("(no exec yet)"));
    return children;
  }

  const viewport = win?.historyViewport ?? DEFAULT_HISTORY_VIEWPORT;
  const indexed = history.map((rec, idx) => ({ rec, idx }));
  const { visible, earlierCount } = applyTranscriptViewport(indexed, viewport);

  const viewportAttrs: Record<string, string> = { total: String(history.length) };
  if (typeof viewport.tail === "number") {
    viewportAttrs.tail = String(viewport.tail);
  } else if (typeof viewport.rangeStart === "number" && typeof viewport.rangeEnd === "number") {
    viewportAttrs.history_start = String(viewport.rangeStart);
    viewportAttrs.history_end = String(viewport.rangeEnd);
  }
  if (earlierCount > 0) viewportAttrs.earlier_omitted = String(earlierCount);
  children.push(xmlElement("history_viewport", viewportAttrs));

  const summary = visible.map(({ rec, idx }) =>
    xmlElement("exec", { id: rec.execId, n: String(idx), kind: rec.language, ok: rec.ok ? "ok" : "fail" }, []),
  );
  children.push(xmlElement("history", {}, summary));

  const last = history[history.length - 1]!;
  children.push(xmlElement("last_output", { exec_id: last.execId }, [xmlText(truncateBytes(last.output))]));
  return children;
}

/** window method：调本解释器窗渲染的 history 视口（tail N 或固定 range）。 */
export const setHistoryWindowMethod: WindowMethod<Data, ProcessWin> = {
  name: "set_history_window",
  description:
    "Adjust which portion of the process's exec history is rendered (tail N or fixed range).",
  schema: {
      history_tail: { type: "number", description: "Show last N execs (positive int; mutually exclusive with start/end)" },
      history_start: { type: "number", description: "Start of range (non-neg int; pairs with history_end)" },
      history_end: { type: "number", description: "End of range (non-neg int; pairs with history_start)" },
    },
  exec: (_ctx: ReadableContext, _self: ReadonlySelfProxy<Data>, before: ProcessWin, args: Record<string, unknown>) => {
    // history_* → core transcript viewport 字段名
    const mapped: Record<string, unknown> = {};
    if ("history_tail" in args) mapped.tail = args.history_tail;
    if ("history_start" in args) mapped.range_start = args.history_start;
    if ("history_end" in args) mapped.range_end = args.history_end;
    const merged = mergeTranscriptViewport(before?.historyViewport ?? DEFAULT_HISTORY_VIEWPORT, mapped);
    if (!merged.ok) throw new Error(`[interpreter_process.set_history_window] ${merged.error}`);
    return { historyViewport: merged.viewport };
  },
};
