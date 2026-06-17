/**
 * search —— ooc class 后端程序路由（不含 visible 前端）。
 *
 * 一处 `export const Class` 装配 constructor + 二维度（executable / readable）。
 * search 是**非单例 class**（有 constructor：每次 glob / grep 造一个 search 实例）。
 *
 * constructor：执行 glob / grep（grep 用 ./grep-impl.ts 的 runner，优先 rg、回退 JS）+ 排序 +
 * 截断到 200 → 返回纯 Data（kind/query/matches/truncated/searchRoot）。失败 throw（runtime 不建窗）。
 * glob vs grep 由 args 区分：带 path / glob / case_insensitive → grep，否则 glob。
 */

import { Glob } from "bun";
import type { OocClass } from "@ooc/core/runtime/ooc-class.js";
import type { ConstructorContext } from "@ooc/core/executable/contract.js";
import { resolveSessionPath } from "@ooc/core/persistable/session-path.js";
import {
  runRipgrep,
  runJsFallback,
  type GrepHit,
} from "./grep-impl.js";
import executable from "./executable/index.js";
import readable from "./readable/index.js";
import type { Data, SearchMatch } from "./types.js";

const SEARCH_MAX_MATCHES = 200;

interface SearchArgs {
  pattern?: string;
  cwd?: string;
  path?: string;
  glob?: string;
  case_insensitive?: boolean;
  mode?: "grep" | "glob";
}

// glob vs grep 优先看调用方显式 `mode`（filesystem.grep/glob 两 method 各自传 "grep"/"glob"）；
// 无 mode 时回退按 args 形状启发式（带 path/glob/case_insensitive → grep）。显式 mode 避免
// 「grep 仅传 pattern 无 path → 误判 glob」「glob 把 pattern 放进 glob 字段 → 误判 grep」两类歧义。
function isGrepArgs(args: SearchArgs): boolean {
  if (args.mode === "grep") return true;
  if (args.mode === "glob") return false;
  return (
    typeof args.path === "string" ||
    typeof args.glob === "string" ||
    args.case_insensitive === true
  );
}

async function buildGrepData(
  ctx: ConstructorContext,
  pattern: string,
  args: SearchArgs,
): Promise<Data> {
  const thread = ctx.thread;
  const rawPath = typeof args.path === "string" ? args.path : "";
  const path = rawPath
    ? resolveSessionPath(thread, rawPath)
    : resolveSessionPath(thread, ".");
  const glob = typeof args.glob === "string" ? args.glob : undefined;
  const caseInsensitive = args.case_insensitive === true;
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
      throw new Error(`[grep] 搜索失败：${(err as Error).message}`);
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
  return {
    kind: "grep",
    query: pattern,
    matches: searchMatches,
    truncated,
    searchRoot: path,
  };
}

function buildGlobData(
  ctx: ConstructorContext,
  pattern: string,
  args: SearchArgs,
): Data {
  const thread = ctx.thread;
  const rawCwd = typeof args.cwd === "string" ? args.cwd : "";
  const cwd = rawCwd
    ? resolveSessionPath(thread, rawCwd)
    : resolveSessionPath(thread, ".");
  let matchesRaw: string[];
  try {
    const g = new Glob(pattern);
    matchesRaw = Array.from(g.scanSync({ cwd, onlyFiles: true, absolute: false }));
  } catch (err) {
    throw new Error(`[glob] 扫描失败：${(err as Error).message}`);
  }
  matchesRaw.sort();
  const truncated = matchesRaw.length > SEARCH_MAX_MATCHES;
  const head = truncated ? matchesRaw.slice(0, SEARCH_MAX_MATCHES) : matchesRaw;
  const matches: SearchMatch[] = head.map((path, index) => ({ index, path }));
  return {
    kind: "glob",
    query: pattern,
    matches,
    truncated,
    searchRoot: cwd,
  };
}

export const Class: OocClass<Data> = {
  construct: {
    description:
      "Search files by name (glob) or content (grep); results appear as a search window.",
    schema: {
      args: {
        pattern: {
          type: "string",
          required: true,
          description: "glob pattern (for glob) or regex pattern (for grep)",
        },
        cwd: {
          type: "string",
          description: "glob: search root directory (relative to session baseDir)",
        },
        path: { type: "string", description: "grep: search directory or file" },
        glob: {
          type: "string",
          description: "grep: filename glob filter (e.g. *.ts)",
        },
        case_insensitive: {
          type: "boolean",
          description: "grep: case insensitive match",
        },
      },
    },
    exec: async (ctx: ConstructorContext, args: SearchArgs): Promise<Data> => {
      const pattern = typeof args.pattern === "string" ? args.pattern : "";
      if (!pattern) {
        const label = isGrepArgs(args) ? "grep" : "glob";
        throw new Error(`[${label}] 缺少 pattern 参数。`);
      }
      return isGrepArgs(args)
        ? buildGrepData(ctx, pattern, args)
        : buildGlobData(ctx, pattern, args);
    },
  },
  executable,
  readable,
};

export type { Data } from "./types.js";
