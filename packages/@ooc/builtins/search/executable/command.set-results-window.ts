/**
 * search_window.set_results_window — matches 渲染视口精细化调整（R1b）。
 *
 * - 默认 resultsViewport = { tail: 50 } —— 仅渲染末 50 个 match
 * - 通过 set_results_window 切换：
 *     args={ matches_tail: 30 }                       → 末 30 个
 *     args={ matches_start: 0, matches_end: 20 }      → 固定区间 [0, 20)
 * - matches_tail 与 matches_start/matches_end 互斥；同一次调用只传其一
 * - 详见 search/results-viewport.ts + _shared/transcript-viewport.ts
 */

import type {
  ObjectMethod,
} from "@ooc/core/extendable/_shared/command-types.js";
import type { Intent } from "@ooc/core/thinkable/context/intent.js";
import type { ContextWindow } from "@ooc/core/executable/windows/_shared/types.js";
import type { MethodExecWindow } from "@ooc/core/executable/windows/method_exec/types.js";
import {
  executeSearchSetResultsViewport,
  hasAnyResultsViewportField,
} from "./results-viewport.js";

function guidanceWindows(form: MethodExecWindow, entries: Record<string, string>): ContextWindow[] {
  const out: ContextWindow[] = [];
  for (const [path, text] of Object.entries(entries)) {
    const safe = path.replace(/[^a-zA-Z0-9_]/g, "_");
    out.push({
      id: "guidance_" + form.id + "_" + safe,
      type: "guidance",
      parentWindowId: form.id,
      boundFormId: form.id,
      title: path,
      status: "open",
      createdAt: 0,
      relevance: { score: 0.8, signalCount: 1 },
      provenance: {
        kind: "derived",
        reason: { mechanism: "form_bound", sourceId: form.command },
        createdAt: 0,
        lastTouchedAt: 0,
      },
      content: text,
      summary: text.length > 200 ? text.slice(0, 200) + "..." : text,
    } as ContextWindow);
  }
  return out;
}

const SEARCH_SET_RESULTS_BASIC =
  "internal/windows/search/set_results_window/basic";
const SEARCH_SET_RESULTS_INPUT =
  "internal/windows/search/set_results_window/input";

const KNOWLEDGE = `
search_window.set_results_window 精细化调整 matches 渲染视口。

打开 search_window 时默认 resultsViewport = { tail: 50 } —— 只渲染末 50 个 match；
更早的 match 以 \`<results_viewport tail=50 total=120 earlier_omitted=70/>\` 形式提示前部还有多少条。

参数（**择一传**，二选一）：
- matches_tail: 末 N 个（必须是正整数）
- matches_start + matches_end: 固定区间 matches[matches_start, matches_end)（非负整数；matches_start ≤ matches_end；必须同时出现）

**matches_tail 与 matches_start/matches_end 互斥**：传 matches_tail 的 args 清空 range；传 range 的 args 清空 tail。

约束（fail-loud）：
- matches_tail 必须是正整数（>= 1）
- matches_start / matches_end 必须是非负整数
- matches_start ≤ matches_end
- matches_start 与 matches_end 必须同时出现

例：
- exec(window_id="<id>", command="set_results_window", args={ matches_tail: 100 })          → 看末 100 个 match
- exec(..., args={ matches_start: 0, matches_end: 30 })                                     → 看前 30 个
- exec(..., args={ matches_start: 50, matches_end: 80 })                                    → 看中间 30 个

**注意**：viewport 只影响**渲染**给 LLM 的内容；open_match(index=...) 仍基于完整 matches 数组按 index 寻址——
即使 match 不在 visible 区间，只要 index 合法就能 open。
`.trim();

export const setResultsWindowCommandForSearch: ObjectMethod = {
  paths: ["set_results_window"],
  schema: {
    args: {
      matches_tail: { type: "number", description: "Show last N matches (positive integer; mutually exclusive with matches_start/matches_end)" },
      matches_start: { type: "number", description: "Start of range (non-negative integer; must pair with matches_end)" },
      matches_end: { type: "number", description: "End of range (non-negative integer; must pair with matches_start)" },
    },
  },
  intent: () => [],
  onFormChange(change, { form }) {
    if (change.kind === "status_changed" && change.to !== "open") return [];
    const args = change.kind === "args_refined" ? change.args : form.accumulatedArgs;
    const formStatus = form.status;
    const entries: Record<string, string> = {
      [SEARCH_SET_RESULTS_BASIC]: KNOWLEDGE,
    };
    if (formStatus === "open" && !hasAnyResultsViewportField(args)) {
      entries[SEARCH_SET_RESULTS_INPUT] =
        "set_results_window 至少需要传入 matches_tail / matches_start+matches_end 之一。\n" +
        "matches_tail 与 matches_start/matches_end 互斥，请 refine 后 submit。";
    }
    return guidanceWindows(form, entries);
  },
  exec: (ctx) => executeSearchSetResultsViewport(ctx),
};
