/**
 * search_window — 把一次 glob / grep 的结果以持久 window 的形式留在 context。
 */

import type {
  MethodExecutionContext,
  ObjectMethod,
} from "@ooc/core/extendable/_shared/method-types.js";
import type { MethodExecWindow } from "@ooc/core/executable/windows/method_exec/types.js";
import type { WindowManager } from "@ooc/core/executable/windows/_shared/manager.js";
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
} from "@ooc/builtins/search/grep-impl.js";

const OPEN_MATCH_TIP = `search_window.open_match 在指定 match 对应的路径上 spawn 一个 file_window。
参数：index（必填，整数，对应 search_window.matches[].index）。
调用：exec(<search_window_id>, "open_match", args={ index: N })`;

const closeMethod: ObjectMethod = {
  description: "Close this search window (does not affect matched files).",
  exec: () => undefined,
};

const openMatchMethod: ObjectMethod = {
  description: "Open a file_window for the match at the given index in this search window.",
  schema: {
    args: {
      index: { type: "number", required: true, description: "match index from search_window.matches[].index" },
    },
  },
  onFormChange(change, { args }) {
    let tip = OPEN_MATCH_TIP;
    let quick_exec_submit = false;
    if (typeof args.index === "number") {
      quick_exec_submit = true;
    } else {
      tip = OPEN_MATCH_TIP + "\n\n需要 args={ index: <整数> }。";
    }
    return { tip, intents: [{ name: "open_match" }], quick_exec_submit };
  },
  exec: (ctx) => executeSearchOpenMatch(ctx),
};

function basename(path: string): string {
  const idx = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return idx >= 0 ? path.slice(idx + 1) : path;
}

const FILE_WINDOW_LINE_CONTEXT = 40;

export async function executeSearchOpenMatch(
  ctx: MethodExecutionContext,
): Promise<string | undefined> {
  const window = ctx.self as SearchWindow;
  const indexArg = ctx.args.index;
  if (typeof indexArg !== "number") {
    return "[search_window.open_match] 缺少 index 参数（应是整数）。";
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

  const absPath = isAbsolute(match.path)
    ? match.path
    : resolve(sw.searchRoot ?? process.cwd(), match.path);

  const fileWindow: FileWindow = {
    id: generateWindowId("file"),
    class: "file",
    parentWindowId: ROOT_WINDOW_ID,
    title: basename(match.path),
    status: "open",
    createdAt: Date.now(),
    path: absPath,
    lines,
  };

  if (ctx.manager) {
    (ctx.manager as WindowManager).insertTypedWindow(fileWindow, ctx.thread);
  } else {
    thread.contextWindows = [...(thread.contextWindows ?? []), fileWindow];
  }
  return undefined;
}

builtinRegistry.registerExecutable("search", {
  methods: {
    close: closeMethod,
    open_match: openMatchMethod,
  },
});

// ─────────────────────────── constructor ──────────────────────────

const SEARCH_TIP = `glob/grep 搜索：
- glob: args={ pattern: "<glob>", cwd? } — 按文件名通配符搜索
- grep: args={ pattern: "<regex>", path?, glob?, case_insensitive? } — 按内容 regex 搜索
结果作为 search_window 留在 context；超过 200 条截断。`;

const SEARCH_MAX_MATCHES = 200;

const searchConstructor: ObjectMethod = {
  kind: "constructor",
  description: "Search files by name (glob) or content (grep); results appear as a search_window.",
  intents: ["glob", "grep"],
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
  onFormChange(change, { args }) {
    const isGrep = typeof args.path === "string" || typeof args.glob === "string" || args.case_insensitive === true;
    const intents = [{ name: isGrep ? "grep" : "glob" }];
    let tip = SEARCH_TIP;
    let quick_exec_submit = false;
    if (typeof args.pattern === "string" && args.pattern.length > 0) {
      quick_exec_submit = true;
      tip = isGrep ? `grepping for ${args.pattern}...` : `globbing ${args.pattern}...`;
    } else {
      tip = SEARCH_TIP + "\n\n需要 args.pattern（字符串）。";
    }
    return { tip, intents, quick_exec_submit };
  },
  exec: async (ctx) => {
    const thread = ctx.thread;
    if (!thread) return { ok: false, error: "[search] 缺少 thread context。" };
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
        class: "search",
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
      return { ok: true, window: sw };
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
      class: "search",
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
    return { ok: true, window: sw };
  },
};

builtinRegistry.registerExecutable("search", {
  methods: {
    close: closeMethod,
    open_match: openMatchMethod,
    glob: searchConstructor,
    grep: searchConstructor,
  },
});
