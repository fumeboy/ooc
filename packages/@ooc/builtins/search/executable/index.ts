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
 * 重新 open(method="glob"|"grep") 即可。
 */

import type {
  MethodExecutionContext,
  ObjectMethod,
} from "@ooc/core/extendable/_shared/method-types.js";
import type { Intent, MethodCallSchema } from "@ooc/core/thinkable/context/intent.js";
import type { ContextWindow } from "@ooc/core/executable/windows/_shared/types.js";
import type { MethodExecWindow } from "@ooc/core/executable/windows/method_exec/types.js";
import type { WindowManager } from "@ooc/core/executable/windows/_shared/manager.js";
import { buildGuidanceWindows } from "@ooc/builtins/_shared/executable/guidance.js";
import { emptyIntent } from "@ooc/builtins/_shared/executable/utils.js";
import { builtinRegistry } from "@ooc/core/extendable/_shared/registry.js";
import { Glob } from "bun";
import { isAbsolute, resolve } from "node:path";
import {
  ROOT_WINDOW_ID,
  generateWindowId,
  type FileWindow,
  type SearchMatch,
} from "@ooc/core/extendable/_shared/types.js";
import type { SearchWindow } from "../types.js";
import { resolveSessionPath } from "@ooc/core/extendable/_shared/session-path.js";
import { DEFAULT_RESULTS_VIEWPORT } from "./results-viewport.js";
import {
  runRipgrep,
  runJsFallback,
  type GrepHit,
} from "@ooc/builtins/root/executable/method.grep.impl.js";
// readable 维度由 barrel index.ts 的 import "./readable.js" 加载（executable 不 import readable）。


export const SEARCH_WINDOW_BASIC_PATH = "internal/windows/search/basic";
export const SEARCH_WINDOW_CLOSE_BASIC = "internal/windows/search/close/basic";
export const SEARCH_WINDOW_OPEN_MATCH_BASIC = "internal/windows/search/open_match/basic";
export const SEARCH_WINDOW_OPEN_MATCH_INPUT = "internal/windows/search/open_match/input";

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

const closeMethod: ObjectMethod = {
  paths: ["close"],
  intent: emptyIntent,
  onFormChange(change, { form }) {
    if (change.kind === "status_changed" && change.to !== "open") return [];
    const entries: Record<string, string> = {
      [SEARCH_WINDOW_CLOSE_BASIC]: CLOSE_KNOWLEDGE,
    };
    return buildGuidanceWindows(form, entries);
  },
  exec: () => undefined,
};

const openMatchMethod: ObjectMethod = {
  paths: ["open_match"],
  schema: {
    args: {
      index: { type: "number", required: true, description: "match index from search_window.matches[].index" },
    },
  },
  intent: emptyIntent,
  onFormChange(change, { form }) {
    if (change.kind === "status_changed" && change.to !== "open") return [];
    // batch C narrowing(N1): onFormChange 的 form 契约层是 base，narrow 回 MethodExecWindow 取 accumulatedArgs。
    const args = change.kind === "args_refined" ? change.args : (form as MethodExecWindow).accumulatedArgs;
    const formStatus = form.status;
    const entries: Record<string, string> = {
      [SEARCH_WINDOW_OPEN_MATCH_BASIC]: OPEN_MATCH_KNOWLEDGE,
    };
    if (formStatus !== "open") return buildGuidanceWindows(form, entries);
    if (typeof args.index !== "number") {
      entries[SEARCH_WINDOW_OPEN_MATCH_INPUT] =
        "open_match 缺少 index；用 args={ index: <整数> }。index 取自当前 search_window.matches[].index。";
    }
    return buildGuidanceWindows(form, entries);
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
  // P6.§3: manager 在 dispatch 阶段已保证 self.type === "search"，method 体不再 re-check。
  const window = ctx.self as SearchWindow;
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
    // batch C narrowing(N2): ctx.manager 契约层是 unknown，narrow 回 WindowManager 取 insertTypedWindow。
    (ctx.manager as WindowManager).insertTypedWindow(fileWindow, ctx.thread);
  } else {
    thread.contextWindows = [...(thread.contextWindows ?? []), fileWindow];
  }
  return undefined;
}

// search_window 的 readable 维度（readable + window method set_results_window + compressView
// + basicKnowledge SEARCH_WINDOW_BASIC_KNOWLEDGE）已迁出到 ../readable.ts。

builtinRegistry.registerExecutable("search", {
  methods: {
    close: closeMethod,
    open_match: openMatchMethod,
  },
});
// readable 维度（registerReadable）在 ../readable.ts 自注册（顶部 side-effect import 触发）。

// ─────────────────────────── constructor (P6.§4-§5) ──────────────────────────

const SEARCH_GLOB_BASIC = "internal/objects/search/glob/basic";
const SEARCH_GLOB_INPUT = "internal/objects/search/glob/input";
const SEARCH_GREP_BASIC = "internal/objects/search/grep/basic";
const SEARCH_GREP_INPUT = "internal/objects/search/grep/input";

const SEARCH_GLOB_KNOWLEDGE = `
glob 用于按文件名通配符（glob pattern）查找文件，并把结果作为 search_window 留在 context。

参数：
- pattern: 必填，glob 通配符。例：\`src/**/*.ts\`、\`*.md\`、\`tests/**/*\`
- cwd: 可选，搜索根目录（相对路径以 session baseDir 为根）；缺省 = session baseDir

行为：
- 用 Bun 内置 Glob 扫描文件系统；只返回文件（onlyFiles=true）
- 命中按 path 字典序排序；超过 200 条截断，search_window.truncated=true
- 命中之后用 \`open(parent_window_id="<search_window_id>", method="open_match", args={ index: <N> })\`
  在该 match 对应的文件上 spawn file_window

调用示例：

\`\`\`
open(method="glob", title="找全部 TS",
     args={ pattern: "src/**/*.ts" })
\`\`\`

注意：
- 这是文件名匹配；要按文件**内容**搜索请用 \`grep\`
- 结果集 ≥ 200 时建议把 pattern 改更精确（本期不提供 next_page）
`.trim();

const SEARCH_GREP_KNOWLEDGE = `
grep 用于按文件**内容**（regex）搜索代码或文档，并把命中作为 search_window 留在 context。

参数：
- pattern: 必填 regex
- path: 可选，搜索目录或文件；缺省 = session baseDir
- glob: 可选，子文件名 glob 过滤（如 "*.ts"）
- case_insensitive: 可选 boolean

行为：
- 优先调 ripgrep（rg --json）；失败回退到内置 JS 实现
- 命中按 (path, line) 排序；超过 200 条截断
- 命中通过 \`open(parent_window_id="<search_window_id>", method="open_match", args={ index })\` 直开 file_window
`.trim();

const SEARCH_MAX_MATCHES = 200;

/**
 * P6.§4-§5 constructor —— 创建 search_window（glob 或 grep）。
 *
 * dispatch 通过 ctx.form?.method:
 *  - "glob"：调 Bun Glob，匹配文件名
 *  - "grep"：先 runRipgrep，失败回退 runJsFallback
 *
 * 行为:
 *  - 校验必填参数 (glob: pattern; grep: pattern)
 *  - 跑搜索，sort + 截断到 200
 *  - generateWindowId("search") + build SearchWindow
 *  - 返回 { ok: true, object: searchWindow }
 *
 * P6 mark: kind="constructor"，manager.submit §2 分支挂载。
 */
const searchConstructor: ObjectMethod = {
  kind: "constructor",
  paths: ["glob", "grep"],
  permission: () => "allow",
  schema: {
    args: {
      pattern: { type: "string", required: true, description: "glob pattern (for glob) or regex pattern (for grep)" },
      cwd: { type: "string", description: "glob: search root directory (relative to session baseDir)" },
      path: { type: "string", description: "grep: search directory or file" },
      glob: { type: "string", description: "grep: filename glob filter (e.g. *.ts)" },
      case_insensitive: { type: "boolean", description: "grep: case insensitive match" },
    },
  },
  intent: (args) => {
    const a = args as Record<string, unknown>;
    if (typeof a.path === "string" || typeof a.glob === "string" || a.case_insensitive === true) {
      return [{ name: "grep" }];
    }
    return [{ name: "glob" }];
  },
  onFormChange(change, { form }) {
    if (change.kind === "status_changed" && change.to !== "open") return [];
    // batch C narrowing(N1): onFormChange 的 form 契约层是 base，narrow 回 MethodExecWindow 取 accumulatedArgs。
    const args = change.kind === "args_refined" ? change.args : (form as MethodExecWindow).accumulatedArgs;
    const formStatus = form.status;
    const entries: Record<string, string> = {
      [SEARCH_GLOB_BASIC]: SEARCH_GLOB_KNOWLEDGE,
      [SEARCH_GREP_BASIC]: SEARCH_GREP_KNOWLEDGE,
    };
    if (formStatus !== "open") return buildGuidanceWindows(form, entries);
    if (typeof args.pattern !== "string" || args.pattern.length === 0) {
      entries[SEARCH_GLOB_INPUT] =
        "glob 还缺以下参数: pattern。\n" +
        "请用 refine(form_id, args={ pattern: \"<glob-string>\", cwd?: \"<dir>\" }) 补齐后 submit(form_id)。\n" +
        "不要 close 重 open——form 当前在 open 状态, refine 是正确路径。";
      entries[SEARCH_GREP_INPUT] =
        "grep 还缺以下参数: pattern。\n" +
        "请用 refine(form_id, args={ pattern: \"<regex>\", path?: \"<dir-or-file>\", glob?: \"*.ts\", case_insensitive?: true }) 补齐后 submit(form_id)。";
    }
    return buildGuidanceWindows(form, entries);
  },
  exec: async (ctx) => {
    const thread = ctx.thread;
    if (!thread) return { ok: false, error: "[search] 缺少 thread context。" };
    // batch C narrowing(N1): ctx.form 契约层是 base ContextWindow，narrow 回 MethodExecWindow 读 command。
    const command = (ctx.form as MethodExecWindow | undefined)?.method ?? "glob";
    const pattern = typeof ctx.args.pattern === "string" ? ctx.args.pattern : "";
    if (!pattern) return { ok: false, error: `[${command}] 缺少 pattern 参数。` };

    if (command === "grep") {
      const rawPath = typeof ctx.args.path === "string" ? ctx.args.path : "";
      const path = rawPath
        ? resolveSessionPath(thread, rawPath)
        : resolveSessionPath(thread, ".");
      const glob = typeof ctx.args.glob === "string" ? ctx.args.glob : undefined;
      const caseInsensitive = ctx.args.case_insensitive === true;
      const opts = { pattern, path, glob, caseInsensitive };

      let matches: GrepHit[] | undefined;
      try {
        matches = await runRipgrep(opts);
      } catch {
        matches = undefined;
      }
      if (matches === undefined) {
        try {
          matches = await runJsFallback(opts);
        } catch (err) {
          return { ok: false, error: `[grep] 搜索失败：${(err as Error).message}` };
        }
      }
      matches.sort((a, b) =>
        a.path === b.path ? a.line - b.line : a.path.localeCompare(b.path),
      );
      const truncated = matches.length > SEARCH_MAX_MATCHES;
      const head = truncated ? matches.slice(0, SEARCH_MAX_MATCHES) : matches;
      const searchMatches: SearchMatch[] = head.map((m, index) => ({
        index,
        path: m.path,
        line: m.line,
        snippet: m.snippet,
      }));
      const sw: SearchWindow = {
        id: generateWindowId("search"),
        type: "search",
        parentWindowId: ROOT_WINDOW_ID,
        title: `grep ${pattern}`,
        status: "open",
        createdAt: Date.now(),
        kind: "grep",
        query: pattern,
        matches: searchMatches,
        truncated,
        searchRoot: path,
        state: { resultsViewport: { ...DEFAULT_RESULTS_VIEWPORT } },
      };
      return { ok: true, object: sw };
    }

    // glob path
    const rawCwd = typeof ctx.args.cwd === "string" ? ctx.args.cwd : "";
    const cwd = rawCwd ? resolveSessionPath(thread, rawCwd) : resolveSessionPath(thread, ".");
    let matchesRaw: string[];
    try {
      const g = new Glob(pattern);
      matchesRaw = Array.from(g.scanSync({ cwd, onlyFiles: true, absolute: false }));
    } catch (err) {
      return { ok: false, error: `[glob] 扫描失败：${(err as Error).message}` };
    }
    matchesRaw.sort();
    const truncated = matchesRaw.length > SEARCH_MAX_MATCHES;
    const head = truncated ? matchesRaw.slice(0, SEARCH_MAX_MATCHES) : matchesRaw;
    const matches: SearchMatch[] = head.map((path, index) => ({ index, path }));
    const sw: SearchWindow = {
      id: generateWindowId("search"),
      type: "search",
      parentWindowId: ROOT_WINDOW_ID,
      title: `glob ${pattern}`,
      status: "open",
      createdAt: Date.now(),
      kind: "glob",
      query: pattern,
      matches,
      truncated,
      searchRoot: cwd,
      state: { resultsViewport: { ...DEFAULT_RESULTS_VIEWPORT } },
    };
    return { ok: true, object: sw };
  },
};

// 二次注册：把 constructor 加进 methods 表（registerExecutable 替换 methods；
// 首次注册的 readable 维度 windowMethods/readable/... 不受影响，保留 existing）。
builtinRegistry.registerExecutable("search", {
  methods: {
    close: closeMethod,
    open_match: openMatchMethod,
    glob: searchConstructor,
    grep: searchConstructor,
  },
});
