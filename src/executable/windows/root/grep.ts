import type {
  CommandExecutionContext,
  CommandKnowledgeEntries,
  CommandTableEntry,
} from "../command-types.js";
import {
  ROOT_WINDOW_ID,
  generateWindowId,
  type SearchMatch,
  type SearchWindow,
} from "../types.js";
import {
  GREP_BASIC_PATH,
  GREP_INPUT_PATH,
  KNOWLEDGE,
  MAX_MATCHES,
  runRipgrep,
  runJsFallback,
  type GrepHit,
} from "./grep-impl.js";

export const grepCommand: CommandTableEntry = {
  paths: ["grep"],
  match: () => ["grep"],
  knowledge: (args, formStatus): CommandKnowledgeEntries => {
    const entries: CommandKnowledgeEntries = { [GREP_BASIC_PATH]: KNOWLEDGE };
    if (formStatus !== "open") return entries;
    if (typeof args.pattern !== "string" || args.pattern.length === 0) {
      entries[GREP_INPUT_PATH] =
        "grep 缺少 pattern；用 args={ pattern: \"<regex>\", path?: \"<dir-or-file>\", glob?: \"*.ts\", case_insensitive?: true }。";
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
  if (!pattern) return "[grep] 缺少 pattern 参数。";
  const path = typeof ctx.args.path === "string" ? ctx.args.path : process.cwd();
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
  };

  if (ctx.manager) {
    ctx.manager.insertTypedWindow(sw);
  } else {
    thread.contextWindows = [...(thread.contextWindows ?? []), sw];
  }
  return undefined;
}
