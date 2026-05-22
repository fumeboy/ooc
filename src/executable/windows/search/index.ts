/**
 * search_window — 把一次 glob / grep 的结果以持久 window 的形式留在 context。
 *
 * 设计要点：
 * - 由 root.glob / root.grep 直建
 * - kind 区分两种搜索；同一 type 复用渲染 / open_match
 * - matches 截断到 200；超过则 truncated=true
 *
 * 注册命令：
 * - close — 释放本搜索窗口
 * - open_match — 在指定 match 的 path 上 spawn 一个 file_window，让结果可被进一步操作
 *
 * 该 window 不持有可被 LLM mutate 的状态：query / matches 在创建时定型；想换条件
 * 重新 open(command="glob"|"grep") 即可。
 */

import type {
  CommandExecutionContext,
  CommandKnowledgeEntries,
  CommandTableEntry,
} from "../_shared/command-types.js";
import { registerWindowType } from "../_shared/registry.js";
import { isAbsolute, resolve } from "node:path";
import {
  ROOT_WINDOW_ID,
  generateWindowId,
  type FileWindow,
  type SearchWindow,
} from "../_shared/types.js";

export const SEARCH_WINDOW_BASIC_PATH = "internal/windows/search/basic";
export const SEARCH_WINDOW_CLOSE_BASIC = "internal/windows/search/close/basic";
export const SEARCH_WINDOW_OPEN_MATCH_BASIC = "internal/windows/search/open_match/basic";
export const SEARCH_WINDOW_OPEN_MATCH_INPUT = "internal/windows/search/open_match/input";

export const SEARCH_WINDOW_BASIC_KNOWLEDGE = `
search_window 是一次 glob 或 grep 搜索的结果窗口，由 \`root.glob\` 或 \`root.grep\` 直建。

每条 match 有一个稳定的 \`index\`，可以通过

\`\`\`
open(parent_window_id="<search_window_id>", command="open_match", args={ index: <N> })
\`\`\`

在该 match 对应的文件上 spawn 一个 file_window，便于继续阅读 / 编辑。

| command    | 作用 |
|------------|------|
| open_match | 在指定 match 的 path 上 spawn 一个 file_window |
| close      | 释放本搜索窗口 |

提醒：
- search_window.matches 截断到 200 条；如果 \`truncated=true\` 表示有更多结果未显示，
  请通过更精确的 query 重新 \`root.glob\` / \`root.grep\`
- 想"翻页"或"改 query 重搜"目前都通过新建 search_window 完成，本期不提供 next_page / refine_query
- grep kind 的 match 带 line + snippet；glob kind 只带 path
- open_match grep 命中时，自动用 [match.line ± 40] 给 file_window 设置 lines 切片，便于看上下文
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
open(parent_window_id="<search_window_id>", command="open_match",
     title="open match #2", args={ index: 2 })
\`\`\`

行为：
- 在 thread.contextWindows 下挂一个 file_window，path 取自 match.path
  - grep kind 时，file_window 会自动用 match.line 附近做 lines 切片，便于快速定位
- search_window 自身不变（不"消费"该 match）；可以重复 open_match
- 索引越界 / 缺 index 等错误返回字符串
`.trim();

const closeCommand: CommandTableEntry = {
  paths: ["close"],
  match: () => ["close"],
  knowledge: (): CommandKnowledgeEntries => ({
    [SEARCH_WINDOW_CLOSE_BASIC]: CLOSE_KNOWLEDGE,
  }),
  exec: () => undefined,
};

const openMatchCommand: CommandTableEntry = {
  paths: ["open_match"],
  match: () => ["open_match"],
  knowledge: (args, formStatus): CommandKnowledgeEntries => {
    const entries: CommandKnowledgeEntries = {
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
  ctx: CommandExecutionContext,
): Promise<string | undefined> {
  const window = ctx.parentWindow;
  if (!window || window.type !== "search") {
    return "[search_window.open_match] 未挂载在 search_window 上。";
  }
  const indexArg = ctx.args.index;
  if (typeof indexArg !== "number") {
    return "[search_window.open_match] 缺少 index 参数（应是整数）。submit 后 form 已 executed, 请 close(form_id) 后重新 open(parent_window_id=\"<search_window_id>\", command=\"open_match\", args={ index: <整数> }) 一次性给齐; index 取自当前 search_window.matches[].index; 下次 open 时直接附 args 可避免失败回路。";
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

registerWindowType("search", {
  commands: {
    close: closeCommand,
    open_match: openMatchCommand,
  },
  basicKnowledge: SEARCH_WINDOW_BASIC_KNOWLEDGE,
});
