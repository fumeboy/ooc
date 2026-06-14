/**
 * 进程 window 的 readable hook + set_history_window window method —— terminal_process /
 * interpreter_process 共用。两类 window 的 history 渲染完全同构（摘要 + 末条 full output），
 * 只是 class 名与 window method 标签不同，故收在 _shared 由工厂注入差异。
 */
import { type RenderContext } from "@ooc/core/extendable/_shared/registry.js";
import { xmlElement, xmlText, xmlComment, truncateBytes, type XmlNode } from "@ooc/core/_shared/types/xml.js";
import {
  applyTranscriptViewport,
  type TranscriptViewport,
} from "@ooc/core/extendable/_shared/transcript-viewport.js";
import type { WindowMethod } from "@ooc/core/_shared/types/window-method.js";
import type { BaseContextWindow } from "@ooc/core/extendable/_shared/types.js";
import type { ProcessExecRecord } from "./process-record.js";
import {
  DEFAULT_HISTORY_VIEWPORT,
  makeHistoryViewport,
} from "./process-history-viewport.js";

interface ProcessWindowLike extends BaseContextWindow {
  history: ProcessExecRecord[];
  historyViewport?: TranscriptViewport;
}

/** 进程 window 的 readable hook：history 摘要（按 historyViewport 截取）+ 最近一条 full output。 */
export function renderProcessHistory(ctx: RenderContext): XmlNode[] {
  const window = ctx.window as ProcessWindowLike;
  const children: XmlNode[] = [];
  if (window.history.length === 0) {
    children.push(xmlComment("(no exec yet)"));
    return children;
  }

  const viewport: TranscriptViewport =
    window.state?.historyViewport ?? window.historyViewport ?? DEFAULT_HISTORY_VIEWPORT;
  const indexed = window.history.map((rec, idx) => ({ rec, idx }));
  const { visible, earlierCount } = applyTranscriptViewport(indexed, viewport);

  const viewportAttrs: Record<string, string> = {
    total: String(window.history.length),
  };
  if (typeof viewport.tail === "number") {
    viewportAttrs.tail = String(viewport.tail);
  } else if (
    typeof viewport.rangeStart === "number" &&
    typeof viewport.rangeEnd === "number"
  ) {
    viewportAttrs.history_start = String(viewport.rangeStart);
    viewportAttrs.history_end = String(viewport.rangeEnd);
  }
  if (earlierCount > 0) {
    viewportAttrs.earlier_omitted = String(earlierCount);
  }
  children.push(xmlElement("history_viewport", viewportAttrs));

  const summary = visible.map(({ rec, idx }) =>
    xmlElement(
      "exec",
      { id: rec.execId, n: String(idx), kind: rec.language, ok: rec.ok ? "ok" : "fail" },
      [],
    ),
  );
  children.push(xmlElement("history", {}, summary));

  const last = window.history[window.history.length - 1]!;
  children.push(
    xmlElement(
      "last_output",
      { exec_id: last.execId },
      [xmlText(truncateBytes(last.output))],
    ),
  );
  return children;
}

/** 为某个进程 window 类构造 set_history_window window method。 */
export function makeSetHistoryWindowMethod(label: string): WindowMethod {
  const { hasAnyField, setViewport } = makeHistoryViewport(label);
  return {
    kind: "window",
    description: "Adjust which portion of the process's exec history is rendered (tail N or fixed range).",
    intents: ["set_history_window"],
    schema: {
      args: {
        history_tail: { type: "number", description: "Show last N execs (positive integer; mutually exclusive with history_start/history_end)" },
        history_start: { type: "number", description: "Start of range (non-negative integer; must pair with history_end)" },
        history_end: { type: "number", description: "End of range (non-negative integer; must pair with history_start)" },
      },
    },
    onFormChange(_change, { args }) {
      const ready = hasAnyField(args);
      return {
        tip: ready
          ? "参数已就绪，submit 应用视口调整。"
          : "set_history_window 需要 history_tail 或 history_start+history_end 之一。",
        intents: [{ name: "set_history_window" }],
        quick_exec_submit: ready,
      };
    },
    exec: (ctx) => setViewport(ctx),
  };
}
