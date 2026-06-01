import type {
  CommandExecutionContext,
  CommandKnowledgeEntries,
  CommandTableEntry,
} from "@ooc/core/extendable/_shared/command-types.js";
import {
  ROOT_WINDOW_ID,
  generateWindowId,
  type SearchMatch,
  type SearchWindow,
} from "@ooc/core/extendable/_shared/types.js";
import {
  GREP_BASIC_PATH,
  GREP_INPUT_PATH,
  KNOWLEDGE,
  MAX_MATCHES,
  runRipgrep,
  runJsFallback,
  type GrepHit,
} from "./command.grep.impl.js";
import { resolveSessionPath } from "@ooc/core/extendable/_shared/session-path.js";
import { DEFAULT_RESULTS_VIEWPORT } from "@ooc/core/executable/windows/search/results-viewport.js";

export const grepCommand: CommandTableEntry = {
  paths: ["grep"],
  match: () => ["grep"],
  knowledge: (args, formStatus): CommandKnowledgeEntries => {
    const entries: CommandKnowledgeEntries = { [GREP_BASIC_PATH]: KNOWLEDGE };
    if (formStatus !== "open") return entries;
    if (typeof args.pattern !== "string" || args.pattern.length === 0) {
      entries[GREP_INPUT_PATH] =
        "grep 还缺以下参数: pattern。\n" +
        "请用 refine(form_id, args={ pattern: \"<regex>\", path?: \"<dir-or-file>\", glob?: \"*.ts\", case_insensitive?: true }) 补齐后 submit(form_id)。\n" +
        "不要 close 重 open——form 当前在 open 状态, refine 是正确路径。";
    }
    return entries;
  },
  exec: (ctx) => executeGrepCommand(ctx),
};

export async function executeGrepCommand(
  ctx: CommandExecutionContext,
): Promise<string | undefined> {
  const thread = ctx.thread;
  if (!thread) return "[grep] 缺少 thread context。";
  const pattern = typeof ctx.args.pattern === "string" ? ctx.args.pattern : "";
  if (!pattern) return "[grep] 缺少 pattern 参数。form 已 submit 失败 (status=failed)。**可以 refine 修正参数后重 submit**（推荐）: refine(form_id, args={ pattern: \"<regex>\", path: \"<dir-or-file>\", glob: \"*.ts\", case_insensitive: true }) 会自动把 form 切回 open, 再 submit; 或 close(form_id) 彻底放弃这次调用。";
  // 默认搜索根 = session 的 baseDir（thread.persistence.baseDir），不到则回退 process.cwd()
  const rawPath = typeof ctx.args.path === "string" ? ctx.args.path : "";
  const path = rawPath ? resolveSessionPath(thread, rawPath) : resolveSessionPath(thread, ".");
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
      return `[grep] 搜索失败：${(err as Error).message}`;
    }
  }

  matches.sort((a, b) =>
    a.path === b.path ? a.line - b.line : a.path.localeCompare(b.path),
  );
  const truncated = matches.length > MAX_MATCHES;
  const head = truncated ? matches.slice(0, MAX_MATCHES) : matches;
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
    resultsViewport: { ...DEFAULT_RESULTS_VIEWPORT },
  };

  if (ctx.manager) {
    ctx.manager.insertTypedWindow(sw, ctx.thread);
  } else {
    thread.contextWindows = [...(thread.contextWindows ?? []), sw];
  }
  return undefined;
}
