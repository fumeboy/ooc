/**
 * base/search/executable — search 原型的 behavior 真源（OOC-4 L4.2c）。
 *
 * methods（close/open_match/set_results_window）+ renderXml + basicKnowledge + compressView +
 * 内部 executeSearchOpenMatch 的**实现**住这里（物理 move 自 windows/search/index.ts）；
 * set_results_window 命令在同目录 command.set-results-window.ts。由活路径沿 base 原型链解析
 * （src/executable/windows/_shared/behavior.ts）。
 *
 * compressView 已进 window 定义（OOC-4 L6c-1），由 render.ts 经 resolveCompressView 沿链解析
 * （compressLevel ≥ 1 时）；薄壳不再 registerWindowType compressView。
 *
 * **留 windows（被 root.glob/grep 创建器命令用 = 跨域共享）**，本目录 import 之：
 * - windows/search/results-viewport.ts（DEFAULT_RESULTS_VIEWPORT / executeSearchSetResultsViewport /
 *   hasAnyResultsViewportField）
 */

import type { ObjectWindowDefinition } from "../../../../executable/server/window-types.js";
import type {
  MethodExecutionContext,
  MethodKnowledgeEntries,
  MethodEntry,
} from "../../../../executable/windows/_shared/method-types.js";
import type { RenderContext } from "../../../../executable/windows/_shared/registry.js";
import { isAbsolute, resolve } from "node:path";
import {
  ROOT_WINDOW_ID,
  generateWindowId,
  type FileWindow,
  type SearchWindow,
} from "../../../../executable/windows/_shared/types.js";
import {
  xmlElement,
  xmlText,
  type XmlNode,
} from "../../../../thinkable/context/xml.js";
import {
  applyTranscriptViewport,
  type TranscriptViewport,
} from "../../../../executable/windows/_shared/transcript-viewport.js";
import { DEFAULT_RESULTS_VIEWPORT } from "../../../../executable/windows/search/results-viewport.js";
import { setResultsWindowCommandForSearch } from "./command.set-results-window.js";

export const SEARCH_WINDOW_BASIC_PATH = "internal/windows/search/basic";
export const SEARCH_WINDOW_CLOSE_BASIC = "internal/windows/search/close/basic";
export const SEARCH_WINDOW_OPEN_MATCH_BASIC = "internal/windows/search/open_match/basic";
export const SEARCH_WINDOW_OPEN_MATCH_INPUT = "internal/windows/search/open_match/input";

export const SEARCH_WINDOW_BASIC_KNOWLEDGE = `
search_window 是一次 glob 或 grep 搜索的结果窗口，由 \`root.glob\` 或 \`root.grep\` 直建。

每条 match 有一个稳定的 \`index\`，可以通过

\`\`\`
open(parent_window_id="<search_window_id>", method="open_match", args={ index: <N> })
\`\`\`

在该 match 对应的文件上 spawn 一个 file_window，便于继续阅读 / 编辑。

| method             | 作用 |
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

const CLOSE_KNOWLEDGE = `
search_window.close 释放本搜索窗口；不影响任何 match 对应的文件。
`.trim();

const OPEN_MATCH_KNOWLEDGE = `
search_window.open_match 在指定 match 对应的路径上 spawn 一个 file_window，便于继续阅读 / 编辑。

参数：
- index: 必填，整数；对应 search_window.matches[].index

调用：
\`\`\`
open(parent_window_id="<search_window_id>", method="open_match",
     title="open match #2", args={ index: 2 })
\`\`\`

行为：
- 在 thread.contextWindows 下挂一个 file_window，path 取自 match.path
  - grep kind 时，file_window 会自动用 match.line 附近做 lines 切片，便于快速定位
- search_window 自身不变（不"消费"该 match）；可以重复 open_match
- 索引越界 / 缺 index 等错误返回字符串
`.trim();

export const closeCommand: MethodEntry = {
  paths: ["close"],
  match: () => ["close"],
  knowledge: (): MethodKnowledgeEntries => ({
    [SEARCH_WINDOW_CLOSE_BASIC]: CLOSE_KNOWLEDGE,
  }),
  exec: () => undefined,
};

export const openMatchCommand: MethodEntry = {
  paths: ["open_match"],
  match: () => ["open_match"],
  knowledge: (args, formStatus): MethodKnowledgeEntries => {
    const entries: MethodKnowledgeEntries = {
      [SEARCH_WINDOW_OPEN_MATCH_BASIC]: OPEN_MATCH_KNOWLEDGE,
    };
    if (formStatus !== "open") return entries;
    if (typeof args.index !== "number") {
      entries[SEARCH_WINDOW_OPEN_MATCH_INPUT] =
        "open_match 缺少 index；用 args={ index: <整数> }。index 取自当前 search_window.matches[].index。";
    }
    return entries;
  },
  exec: (ctx) => executeSearchOpenMatch(ctx),
};

function basename(path: string): string {
  const idx = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return idx >= 0 ? path.slice(idx + 1) : path;
}

const FILE_WINDOW_LINE_CONTEXT = 40;

/**
 * search_window.open_match：根据 match index 在 thread.contextWindows 下挂一个 file_window。
 *
 * grep kind 的 match 携带 line，spawn 时用 [max(0,line-CONTEXT), line+CONTEXT] 做 lines 切片，
 * 让 LLM 第一时间看到上下文；glob kind 的 match 没有 line，整体打开。
 */
export async function executeSearchOpenMatch(
  ctx: MethodExecutionContext,
): Promise<string | undefined> {
  const window = ctx.parentWindow;
  if (!window || window.type !== "search") {
    return "[search_window.open_match] 未挂载在 search_window 上。";
  }
  const indexArg = ctx.args.index;
  if (typeof indexArg !== "number") {
    return "[search_window.open_match] 缺少 index 参数（应是整数）。submit 后 form 已 executed, 请 close(form_id) 后重新 open(parent_window_id=\"<search_window_id>\", method=\"open_match\", args={ index: <整数> }) 一次性给齐; index 取自当前 search_window.matches[].index; 下次 open 时直接附 args 可避免失败回路。";
  }
  const sw = window as SearchWindow;
  const match = sw.matches.find((m) => m.index === indexArg);
  if (!match) {
    return `[search_window.open_match] match index ${indexArg} 不存在（当前 ${sw.matches.length} 条 match，最大 index ${sw.matches.length - 1}）。`;
  }

  const thread = ctx.thread;
  if (!thread) return "[search_window.open_match] 缺少 thread context。";

  const lines: [number, number] | undefined =
    typeof match.line === "number"
      ? [Math.max(0, match.line - FILE_WINDOW_LINE_CONTEXT), match.line + FILE_WINDOW_LINE_CONTEXT]
      : undefined;

  // match.path 可能是绝对（rg/JS fallback）或 search_window.searchRoot 相对（glob with absolute:false）。
  // file_window 后续走 fs.readFile/writeFile，必须给绝对路径，否则会落到 process.cwd()。
  const absPath = isAbsolute(match.path)
    ? match.path
    : resolve(sw.searchRoot ?? process.cwd(), match.path);

  const fileWindow: FileWindow = {
    id: generateWindowId("file"),
    type: "file",
    parentWindowId: ROOT_WINDOW_ID,
    title: basename(match.path),
    status: "open",
    createdAt: Date.now(),
    path: absPath,
    lines,
  };

  if (ctx.manager) {
    ctx.manager.insertTypedWindow(fileWindow);
  } else {
    thread.contextWindows = [...(thread.contextWindows ?? []), fileWindow];
  }
  return undefined;
}

/** search_window 的 renderXml hook：kind + query + matches（按 resultsViewport 截取）。 */
export function renderSearchWindow(ctx: RenderContext): XmlNode[] {
  const window = ctx.window as SearchWindow;
  const children: XmlNode[] = [
    xmlElement("kind", {}, [xmlText(window.kind)]),
    xmlElement("query", {}, [xmlText(window.query)]),
  ];
  if (window.searchRoot) {
    children.push(xmlElement("search_root", {}, [xmlText(window.searchRoot)]));
  }

  const viewport: TranscriptViewport =
    window.resultsViewport ?? DEFAULT_RESULTS_VIEWPORT;
  const { visible, earlierCount } = applyTranscriptViewport(
    window.matches,
    viewport,
  );

  // 始终暴露 results_viewport 元节点（让 LLM 知道当前可见区间 + 前部省略数）
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

const SEARCH_PREVIEW_COUNT = 3;
const SEARCH_SNIPPET_TRUNCATE = 200;

/**
 * search_window 的 compressView hook（design §4.1）。
 *
 * - Level 1 (folded):  kind + query + matches.count + 前 3 条 match 预览(仅 path + line)
 * - Level 2 (snapshot): kind + query + matches.count
 *
 * snippet 在预览节点内截断到 SEARCH_SNIPPET_TRUNCATE 字符,避免单次 grep 命中一行特别长
 * 时把折叠态又撑回去。
 */
export function compressSearchWindow(
  ctx: RenderContext,
  level: 1 | 2,
): XmlNode[] {
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

export const window: ObjectWindowDefinition = {
  methods: {
    close: closeCommand,
    open_match: openMatchCommand,
    set_results_window: setResultsWindowCommandForSearch,
  },
  renderXml: renderSearchWindow,
  basicKnowledge: SEARCH_WINDOW_BASIC_KNOWLEDGE,
  compressView: compressSearchWindow,
};
