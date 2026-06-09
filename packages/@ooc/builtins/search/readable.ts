import { builtinRegistry, type RenderContext } from "@ooc/core/extendable/_shared/registry.js";
import type { SearchWindow } from "./types.js";
import { xmlElement, xmlText, type XmlNode } from "@ooc/core/thinkable/context/xml.js";
import {
  applyTranscriptViewport,
  type TranscriptViewport,
} from "@ooc/core/extendable/_shared/transcript-viewport.js";
import {
  DEFAULT_RESULTS_VIEWPORT,
  searchSetResultsViewport,
  hasAnyResultsViewportField,
} from "./executable/results-viewport.js";
import type { WindowMethod } from "@ooc/core/_shared/types/window-method.js";
import type { MethodExecWindow } from "@ooc/core/executable/windows/method_exec/types.js";
import { buildGuidanceWindows } from "@ooc/builtins/_shared/executable/guidance.js";
import { emptyIntent } from "@ooc/builtins/_shared/executable/utils.js";

const SEARCH_PREVIEW_COUNT = 3;
const SEARCH_SNIPPET_TRUNCATE = 200;

const SEARCH_SET_RESULTS_BASIC = "internal/windows/search/set_results_window/basic";
const SEARCH_SET_RESULTS_INPUT = "internal/windows/search/set_results_window/input";

export const SEARCH_WINDOW_BASIC_KNOWLEDGE = `
search_window 是一次 glob 或 grep 搜索的结果窗口，由 \`root.glob\` 或 \`root.grep\` 直建。

每条 match 有一个稳定的 \`index\`，可以通过

\`\`\`
open(parent_window_id="<search_window_id>", method="open_match", args={ index: <N> })
\`\`\`

在该 match 对应的文件上 spawn 一个 file_window，便于继续阅读 / 编辑。

| command            | 作用 |
|--------------------|------|
| open_match         | 在指定 match 的 path 上 spawn 一个 file_window |
| set_results_window | 调整 matches 渲染视口（matches_tail / matches_start+matches_end；默认 tail=50） |
| close              | 释放本搜索窗口 |

提醒：
- search_window.matches 截断到 200 条；如果 \`truncated=true\` 表示有更多结果未显示，
  请通过更精确的 query 重新 \`root.glob\` / \`root.grep\`
- 想"翻页"或"改 query 重搜"目前都通过新建 search_window 完成，本期不提供 next_page / refine_query
- grep kind 的 match 带 line + snippet；glob kind 只带 path
- open_match grep 命中时，自动用 [match.line ± 40] 给 file_window 设置 lines 切片，便于看上下文
- 渲染层默认按 resultsViewport={ tail: 50 } 只展示末 50 个 match；\`<results_viewport total=N tail=50 earlier_omitted=M/>\`
  元节点暴露省略数；想看其它区间用 set_results_window；open_match 依然按完整 matches 的 index 寻址，不受 viewport 影响
`.trim();

export function readable(ctx: RenderContext): XmlNode[] {
  const window = ctx.window as SearchWindow;
  const children: XmlNode[] = [
    xmlElement("kind", {}, [xmlText(window.kind)]),
    xmlElement("query", {}, [xmlText(window.query)]),
  ];
  if (window.searchRoot) {
    children.push(xmlElement("search_root", {}, [xmlText(window.searchRoot)]));
  }

  // 展示状态从 window.state 读，向后兼容旧平铺字段。
  const viewport: TranscriptViewport =
    window.state?.resultsViewport ?? window.resultsViewport ?? DEFAULT_RESULTS_VIEWPORT;
  const { visible, earlierCount } = applyTranscriptViewport(
    window.matches,
    viewport,
  );

  const viewportAttrs: Record<string, string> = {
    total: String(window.matches.length),
  };
  if (typeof viewport.tail === "number") {
    viewportAttrs.tail = String(viewport.tail);
  } else if (
    typeof viewport.rangeStart === "number" &&
    typeof viewport.rangeEnd === "number"
  ) {
    viewportAttrs.matches_start = String(viewport.rangeStart);
    viewportAttrs.matches_end = String(viewport.rangeEnd);
  }
  if (earlierCount > 0) {
    viewportAttrs.earlier_omitted = String(earlierCount);
  }
  children.push(xmlElement("results_viewport", viewportAttrs));

  const matchNodes: XmlNode[] = visible.map((m) => {
    const attrs: Record<string, string> = {
      index: String(m.index),
      path: m.path,
    };
    if (typeof m.line === "number") attrs.line = String(m.line);
    return xmlElement("match", attrs, m.snippet ? [xmlText(m.snippet)] : []);
  });

  children.push(
    xmlElement(
      "matches",
      {
        count: String(window.matches.length),
        truncated: window.truncated ? "true" : "false",
      },
      matchNodes,
    ),
  );
  return children;
}

const SET_RESULTS_KNOWLEDGE = `
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
- exec(window_id="<id>", method="set_results_window", args={ matches_tail: 100 })          → 看末 100 个 match
- exec(..., args={ matches_start: 0, matches_end: 30 })                                     → 看前 30 个
- exec(..., args={ matches_start: 50, matches_end: 80 })                                    → 看中间 30 个

**注意**：viewport 只影响**渲染**给 LLM 的内容；open_match(index=...) 仍基于完整 matches 数组按 index 寻址——
即使 match 不在 visible 区间，只要 index 合法就能 open。
`.trim();

const setResultsWindowCommandForSearch: WindowMethod = {
  kind: "window",
  paths: ["set_results_window"],
  schema: {
    args: {
      matches_tail: { type: "number", description: "Show last N matches (positive integer; mutually exclusive with matches_start/matches_end)" },
      matches_start: { type: "number", description: "Start of range (non-negative integer; must pair with matches_end)" },
      matches_end: { type: "number", description: "End of range (non-negative integer; must pair with matches_start)" },
    },
  },
  intent: emptyIntent,
  onFormChange(change, { form }) {
    if (change.kind === "status_changed" && change.to !== "open") return [];
    // batch C narrowing(N1): onFormChange 的 form 契约层是 base，narrow 回 MethodExecWindow 取 accumulatedArgs。
    const args = change.kind === "args_refined" ? change.args : (form as MethodExecWindow).accumulatedArgs;
    const formStatus = form.status;
    const entries: Record<string, string> = {
      [SEARCH_SET_RESULTS_BASIC]: SET_RESULTS_KNOWLEDGE,
    };
    if (formStatus === "open" && !hasAnyResultsViewportField(args)) {
      entries[SEARCH_SET_RESULTS_INPUT] =
        "set_results_window 至少需要传入 matches_tail / matches_start+matches_end 之一。\n" +
        "matches_tail 与 matches_start/matches_end 互斥，请 refine 后 submit。";
    }
    return buildGuidanceWindows(form, entries);
  },
  exec: (ctx) => searchSetResultsViewport(ctx),
};

/**
 * search_window 的 compressView hook（design §4.1）。
 * - Level 1 (folded):  kind + query + matches.count + 前 3 条 match 预览(仅 path + line)
 * - Level 2 (snapshot): kind + query + matches.count
 */
function compressSearchWindow(ctx: RenderContext, level: 1 | 2): XmlNode[] {
  const window = ctx.window as SearchWindow;
  const children: XmlNode[] = [
    xmlElement("kind", {}, [xmlText(window.kind)]),
    xmlElement("query", {}, [xmlText(window.query)]),
    xmlElement("matches", {
      count: String(window.matches.length),
      truncated: window.truncated ? "true" : "false",
    }),
  ];
  if (level === 1 && window.matches.length > 0) {
    const previewNodes: XmlNode[] = window.matches
      .slice(0, SEARCH_PREVIEW_COUNT)
      .map((m) => {
        const attrs: Record<string, string> = {
          index: String(m.index),
          path: m.path,
        };
        if (typeof m.line === "number") attrs.line = String(m.line);
        const snippet = m.snippet ? m.snippet.slice(0, SEARCH_SNIPPET_TRUNCATE) : undefined;
        return xmlElement("preview", attrs, snippet ? [xmlText(snippet)] : []);
      });
    children.push(xmlElement("preview_list", {}, previewNodes));
  }
  children.push(
    xmlElement("compressed", {
      level: String(level),
      hint: "exec(window_id, 'expand') to restore",
    }),
  );
  return children;
}

// readable 维度自注册（readable + window method set_results_window + compressView + basicKnowledge）。
builtinRegistry.registerReadable("search", {
  windowMethods: {
    set_results_window: setResultsWindowCommandForSearch,
  },
  readable,
  compressView: compressSearchWindow,
  basicKnowledge: SEARCH_WINDOW_BASIC_KNOWLEDGE,
});
