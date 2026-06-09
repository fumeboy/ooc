import { builtinRegistry, type RenderContext } from "@ooc/core/extendable/_shared/registry.js";
import type { ProgramWindow } from "./types.js";
import { xmlElement, xmlText, xmlComment, truncateBytes, type XmlNode } from "@ooc/core/thinkable/context/xml.js";
import {
  applyTranscriptViewport,
  type TranscriptViewport,
} from "@ooc/core/extendable/_shared/transcript-viewport.js";
import {
  DEFAULT_HISTORY_VIEWPORT,
  programSetHistoryViewport,
  hasAnyHistoryViewportField,
} from "./executable/history-viewport.js";
import type { WindowMethod } from "@ooc/core/_shared/types/window-method.js";
import type { MethodExecWindow } from "@ooc/core/executable/windows/method_exec/types.js";
import { buildGuidanceWindows } from "@ooc/builtins/_shared/executable/guidance.js";
import { emptyIntent } from "@ooc/builtins/_shared/executable/utils.js";

const PROGRAM_WINDOW_SET_HISTORY_BASIC = "internal/windows/program/set_history_window/basic";
const PROGRAM_WINDOW_SET_HISTORY_INPUT = "internal/windows/program/set_history_window/input";

const SET_HISTORY_KNOWLEDGE = `
program_window.set_history_window 精细化调整 exec history 渲染视口。

打开 program_window 时默认 historyViewport = { tail: 10 } —— 只渲染末 10 次 exec；
更早的 exec 以 \`<history_viewport tail=10 total=42 earlier_omitted=32/>\` 形式提示前部还有多少条。

参数（**择一传**，二选一）：
- history_tail: 末 N 次（必须是正整数）
- history_start + history_end: 固定区间 history[history_start, history_end)（非负整数；history_start ≤ history_end；必须同时出现）

**history_tail 与 history_start/history_end 互斥**：传 history_tail 的 args 清空 range；传 range 的 args 清空 tail。

约束（fail-loud）：
- history_tail 必须是正整数（>= 1）
- history_start / history_end 必须是非负整数
- history_start ≤ history_end
- history_start 与 history_end 必须同时出现

例：
- exec(window_id="<id>", method="set_history_window", args={ history_tail: 30 })          → 看末 30 次 exec
- exec(..., args={ history_start: 0, history_end: 5 })                                     → 看前 5 次
- exec(..., args={ history_start: 10, history_end: 20 })                                   → 看中间 10 次

**注意**：viewport 只影响**渲染**给 LLM 的 history summary 与 last_output 锚点；
后续 exec 仍正常追加到完整 history（不受 viewport 影响）。
`.trim();

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

const setHistoryWindowMethod: WindowMethod = {
  kind: "window",
  paths: ["set_history_window"],
  schema: {
    args: {
      history_tail: { type: "number", description: "Show last N execs (positive integer; mutually exclusive with history_start/history_end)" },
      history_start: { type: "number", description: "Start of range (non-negative integer; must pair with history_end)" },
      history_end: { type: "number", description: "End of range (non-negative integer; must pair with history_start)" },
    },
  },
  intent: emptyIntent,
  onFormChange(change, { form }) {
    if (change.kind === "status_changed" && change.to !== "open") return [];
    // batch C narrowing(N1): onFormChange 的 form 契约层是 base，narrow 回 MethodExecWindow 取 accumulatedArgs。
    const args = change.kind === "args_refined" ? change.args : (form as MethodExecWindow).accumulatedArgs;
    const formStatus = form.status;
    const entries: Record<string, string> = {
      [PROGRAM_WINDOW_SET_HISTORY_BASIC]: SET_HISTORY_KNOWLEDGE,
    };
    if (formStatus === "open" && !hasAnyHistoryViewportField(args)) {
      entries[PROGRAM_WINDOW_SET_HISTORY_INPUT] =
        "set_history_window 至少需要传入 history_tail / history_start+history_end 之一。\n" +
        "history_tail 与 history_start/history_end 互斥，请 refine 后 submit。";
    }
    return buildGuidanceWindows(form, entries);
  },
  exec: (ctx) => programSetHistoryViewport(ctx),
};

// readable 维度自注册（readable + window method set_history_window）。
builtinRegistry.registerReadable("program", {
  windowMethods: {
    set_history_window: setHistoryWindowMethod,
  },
  readable,
});
