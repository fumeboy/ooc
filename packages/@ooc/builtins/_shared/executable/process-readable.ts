/**
 * 进程 window 的 readable 投影 + set_history_window window method —— terminal_process /
 * interpreter_process 共用（两类进程窗 history 渲染完全同构）。
 *
 * 新对象模型契约：renderProcessHistory 是纯函数 `(history, win) => XmlNode[]`（读 Data.history +
 * 投影态 win.historyViewport，不再读整窗）；makeSetHistoryWindowMethod 产出新契约 WindowMethod
 * `(ctx, self, before_win, args) => 新 win`。直接用 core 的 transcript viewport 纯函数（绕过旧
 * viewport-adapter 中间层）。history_* 前缀在此 remap 到 core 的 tail / range_start / range_end。
 */
import { xmlElement, xmlText, xmlComment, truncateBytes, type XmlNode } from "@ooc/core/_shared/types/xml.js";
import {
  applyTranscriptViewport,
  mergeTranscriptViewport,
  type TranscriptViewport,
} from "@ooc/core/extendable/_shared/transcript-viewport.js";
import type { WindowMethod, ReadableContext } from "@ooc/core/readable/contract.js";
import type { ProcessExecRecord } from "./process-record.js";

/** 进程窗的投影态（与 Data 分离）：history 视口。 */
export interface ProcessWin {
  historyViewport?: TranscriptViewport;
}

/** 进程窗 Data 的 history 子结构（terminal_process / interpreter_process 的 Data 至少含 history）。 */
export interface ProcessHistoryData {
  history: ProcessExecRecord[];
}

/** 进程 window 的默认 history viewport：末 10 次 exec。 */
export const DEFAULT_HISTORY_VIEWPORT: TranscriptViewport = Object.freeze({ tail: 10 });

/** 进程 window 的 readable 投影 body：history 摘要（按 viewport 截取）+ 最近一条 full output。 */
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

/** 为某个进程 window 类构造 set_history_window window method（新契约）。 */
export function makeSetHistoryWindowMethod(
  label: string,
): WindowMethod<ProcessHistoryData, ProcessWin> {
  return {
    name: "set_history_window",
    description:
      "Adjust which portion of the process's exec history is rendered (tail N or fixed range).",
    schema: {
      args: {
        history_tail: { type: "number", description: "Show last N execs (positive int; mutually exclusive with start/end)" },
        history_start: { type: "number", description: "Start of range (non-neg int; pairs with history_end)" },
        history_end: { type: "number", description: "End of range (non-neg int; pairs with history_start)" },
      },
    },
    exec: (_ctx: ReadableContext, _self: ProcessHistoryData, before: ProcessWin, args: Record<string, unknown>) => {
      // history_* → core transcript viewport 字段名
      const mapped: Record<string, unknown> = {};
      if ("history_tail" in args) mapped.tail = args.history_tail;
      if ("history_start" in args) mapped.range_start = args.history_start;
      if ("history_end" in args) mapped.range_end = args.history_end;
      const merged = mergeTranscriptViewport(before?.historyViewport ?? DEFAULT_HISTORY_VIEWPORT, mapped);
      if (!merged.ok) throw new Error(`[${label}.set_history_window] ${merged.error}`);
      return { historyViewport: merged.viewport };
    },
  };
}
