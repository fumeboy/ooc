/**
 * root.glob command — 用 Bun 内置 Glob 做文件名匹配，结果以 search_window 形式持久化。
 *
 * - args: pattern（必填）, cwd?（可选，默认 session baseDir；相对路径以 baseDir 为根）
 * - 命中条目按 path 字典序排序；超过 200 条截断（truncated=true）
 * - 失败（pattern 非法 / cwd 不可读）：返回错误字符串，不留 search_window
 *
 * 与 program(language="shell", code="find ...") 的差别：search_window 持久化结果，
 * LLM 后续可以 open_match(index) 直接打开命中文件，不必从裸 stdout 里 re-parse。
 */

import { Glob } from "bun";

import type {
  CommandExecutionContext,
  CommandKnowledgeEntries,
  CommandTableEntry,
} from "../_shared/command-types.js";
import {
  ROOT_WINDOW_ID,
  generateWindowId,
  type SearchMatch,
  type SearchWindow,
} from "../_shared/types.js";
import { resolveSessionPath } from "../_shared/session-path.js";
import { DEFAULT_RESULTS_VIEWPORT } from "../search/results-viewport.js";

const GLOB_BASIC_PATH = "internal/executable/glob/basic";
const GLOB_INPUT_PATH = "internal/executable/glob/input";

const MAX_MATCHES = 200;

const KNOWLEDGE = `
glob 用于按文件名通配符（glob pattern）查找文件，并把结果作为 search_window 留在 context。

参数：
- pattern: 必填，glob 通配符。例：\`src/**/*.ts\`、\`*.md\`、\`tests/**/*\`
- cwd: 可选，搜索根目录（相对路径以 session baseDir 为根）；缺省 = session baseDir

行为：
- 用 Bun 内置 Glob 扫描文件系统；只返回文件（onlyFiles=true）
- 命中按 path 字典序排序；超过 200 条截断，search_window.truncated=true
- 命中之后用 \`open(parent_window_id="<search_window_id>", command="open_match", args={ index: <N> })\`
  在该 match 对应的文件上 spawn file_window

调用示例：

\`\`\`
open(command="glob", title="找全部 TS",
     args={ pattern: "src/**/*.ts" })
\`\`\`

注意：
- 这是文件名匹配；要按文件**内容**搜索请用 \`grep\`
- 结果集 ≥ 200 时建议把 pattern 改更精确（本期不提供 next_page）
`.trim();

export const globCommand: CommandTableEntry = {
  paths: ["glob"],
  match: () => ["glob"],
  knowledge: (args, formStatus): CommandKnowledgeEntries => {
    const entries: CommandKnowledgeEntries = { [GLOB_BASIC_PATH]: KNOWLEDGE };
    if (formStatus !== "open") return entries;
    const pattern = typeof args.pattern === "string" ? args.pattern : "";
    if (!pattern) {
      entries[GLOB_INPUT_PATH] =
        "glob 还缺以下参数: pattern。\n" +
        "请用 refine(form_id, args={ pattern: \"<glob-string>\", cwd?: \"<dir>\" }) 补齐后 submit(form_id)。\n" +
        "不要 close 重 open——form 当前在 open 状态, refine 是正确路径。";
    }
    return entries;
  },
  exec: (ctx) => executeGlobCommand(ctx),
};

export async function executeGlobCommand(
  ctx: CommandExecutionContext,
): Promise<string | undefined> {
  const thread = ctx.thread;
  if (!thread) return "[glob] 缺少 thread context。";
  const pattern = typeof ctx.args.pattern === "string" ? ctx.args.pattern : "";
  if (!pattern) return "[glob] 缺少 pattern 参数。form 已 submit 失败 (status=failed)。**可以 refine 修正参数后重 submit**（推荐）: refine(form_id, args={ pattern: \"<glob-string>\", cwd: \"<dir>\" }) 会自动把 form 切回 open, 再 submit; 或 close(form_id) 彻底放弃这次调用。";
  // 默认 cwd = session 的 baseDir (thread.persistence.baseDir)，不到则回退 process.cwd()
  const rawCwd = typeof ctx.args.cwd === "string" ? ctx.args.cwd : "";
  const cwd = rawCwd ? resolveSessionPath(thread, rawCwd) : resolveSessionPath(thread, ".");

  let matchesRaw: string[];
  try {
    const glob = new Glob(pattern);
    matchesRaw = [];
    for (const path of glob.scanSync({ cwd, onlyFiles: true, absolute: false })) {
      matchesRaw.push(path);
    }
  } catch (err) {
    return `[glob] 扫描失败：${(err as Error).message}`;
  }

  matchesRaw.sort();
  const truncated = matchesRaw.length > MAX_MATCHES;
  const head = truncated ? matchesRaw.slice(0, MAX_MATCHES) : matchesRaw;
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
    resultsViewport: { ...DEFAULT_RESULTS_VIEWPORT },
  };

  if (ctx.manager) {
    ctx.manager.insertTypedWindow(sw, ctx.thread);
  } else {
    thread.contextWindows = [...(thread.contextWindows ?? []), sw];
  }
  return undefined;
}
