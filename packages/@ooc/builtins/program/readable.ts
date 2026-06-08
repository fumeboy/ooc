import { type RenderContext } from "@ooc/core/extendable/_shared/registry.js";
import type { ProgramWindow } from "./types.js";
import { xmlElement, xmlText, xmlComment, truncateBytes, type XmlNode } from "@ooc/core/thinkable/context/xml.js";
import {
  applyTranscriptViewport,
  type TranscriptViewport,
} from "@ooc/core/extendable/_shared/transcript-viewport.js";
import { DEFAULT_HISTORY_VIEWPORT } from "./executable/history-viewport.js";

/** program_window 的 readable hook：history 摘要（按 historyViewport 截取）+ 最近一条 full output。 */
export function readable(ctx: RenderContext): XmlNode[] {
  const window = ctx.window as ProgramWindow;
  const children: XmlNode[] = [];
  if (window.history.length === 0) {
    children.push(xmlComment("(no exec yet)"));
    return children;
  }

  // 展示状态从 window.state 读，向后兼容旧平铺字段。
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
