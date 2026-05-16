/**
 * grep 实现细节：rg --json 驱动 + JS RegExp fallback。
 * 拆出此文件让 grep.ts 命令注册保持短小。
 */

import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

export const GREP_BASIC_PATH = "internal/executable/grep/basic";
export const GREP_INPUT_PATH = "internal/executable/grep/input";
export const MAX_MATCHES = 200;
export const SNIPPET_MAX = 200;

export const KNOWLEDGE = `
grep 用于按文件内容搜索（正则），结果作为 search_window kind=grep 留在 context。

参数：
- pattern: 必填，正则表达式
- path: 可选，搜索根目录或单个文件；缺省 = 当前工作目录
- glob: 可选，文件名过滤 glob（如 "*.ts"）
- case_insensitive: 可选 bool

行为：
- 优先调用 rg --json；不可用时回退 JS 实现，输出结构一致
- 每条 match 含 path / line(0-based) / snippet（单行 trim 到 200 字符）
- 按 (path, line) 字典序；超过 200 条截断
- 命中之后用 \`open(parent_window_id="<search_window_id>", command="open_match", args={ index: <N> })\`
  spawn file_window；grep match 自动套上 [line ± 40] 切片
`.trim();

export interface GrepOptions {
  pattern: string;
  path: string;
  glob?: string;
  caseInsensitive: boolean;
}

export interface GrepHit {
  path: string;
  line: number; // 0-based
  snippet: string;
}

export function trimSnippet(s: string): string {
  return s.length <= SNIPPET_MAX ? s : `${s.slice(0, SNIPPET_MAX)}…`;
}

/**
 * runRipgrep —— 调用 `rg --json` 并解析 NDJSON 输出。
 *
 * exit code 约定：
 * - 0 = 命中
 * - 1 = 无命中（正常情况，返回空数组）
 * - >=2 = rg 异常（如 regex 解析失败 / 路径不可读）→ 抛错让调用方走 fallback
 *
 * 也用于 rg 命令本身不存在的场景：spawnSync 抛 ENOENT，由调用方 catch 后转 fallback。
 */
export async function runRipgrep(opts: GrepOptions): Promise<GrepHit[]> {
  const args = ["--json", "--no-heading"];
  if (opts.caseInsensitive) args.push("-i");
  if (opts.glob) args.push("-g", opts.glob);
  args.push(opts.pattern, opts.path);

  const proc = Bun.spawnSync(["rg", ...args], { stdout: "pipe", stderr: "pipe" });
  if (proc.exitCode === 1) return [];
  if (proc.exitCode !== 0) {
    const err = new TextDecoder().decode(proc.stderr).trim();
    throw new Error(err || `rg exited with code ${proc.exitCode}`);
  }

  const out = new TextDecoder().decode(proc.stdout);
  const hits: GrepHit[] = [];
  for (const raw of out.split("\n")) {
    if (!raw) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue;
    }
    if (!parsed || typeof parsed !== "object") continue;
    const obj = parsed as Record<string, unknown>;
    if (obj.type !== "match") continue;
    const data = obj.data as Record<string, unknown> | undefined;
    if (!data) continue;
    const pathObj = data.path as { text?: string } | undefined;
    const linesObj = data.lines as { text?: string } | undefined;
    const lineNumber = data.line_number as number | undefined;
    if (!pathObj?.text || typeof lineNumber !== "number") continue;
    const lineText = (linesObj?.text ?? "").replace(/\r?\n$/, "");
    hits.push({
      path: pathObj.text,
      line: lineNumber - 1, // rg is 1-based; normalize to 0-based
      snippet: trimSnippet(lineText),
    });
  }
  return hits;
}

/**
 * runJsFallback —— 不依赖外部进程的内置实现。
 *
 * 用途：
 * - rg 不在 PATH 时（比如最小容器镜像）
 * - 测试想强制走纯 JS 路径以脱钩 rg 版本差异
 *
 * 输出形状与 runRipgrep 完全一致；递归遍历目录，逐行 RegExp.test。
 * regex 编译失败抛错（错误信息包含 "invalid regex" 关键字，便于上层归类）。
 */
export async function runJsFallback(opts: GrepOptions): Promise<GrepHit[]> {
  const flags = opts.caseInsensitive ? "gi" : "g";
  let re: RegExp;
  try {
    re = new RegExp(opts.pattern, flags);
  } catch (err) {
    throw new Error(`invalid regex: ${(err as Error).message}`);
  }

  const hits: GrepHit[] = [];
  const globMatcher = opts.glob ? new Bun.Glob(opts.glob) : undefined;

  const matchesGlob = (filePath: string): boolean => {
    if (!globMatcher) return true;
    const base = filePath.split(/[/\\]/).pop() ?? filePath;
    return globMatcher.match(base) || globMatcher.match(filePath);
  };

  const grepFile = async (filePath: string): Promise<void> => {
    if (!matchesGlob(filePath)) return;
    let body: string;
    try {
      body = await readFile(filePath, "utf8");
    } catch {
      return;
    }
    const lines = body.split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
      re.lastIndex = 0;
      if (re.test(lines[i]!)) {
        hits.push({
          path: filePath,
          line: i,
          snippet: trimSnippet(lines[i]!),
        });
      }
    }
  };

  const visitDir = async (dir: string): Promise<void> => {
    let entries: Array<{ name: string; isDirectory: () => boolean; isFile: () => boolean }>;
    try {
      // readdir 的 Dirent<NonSharedBuffer> 类型与 @types/node 的 Dirent<string> 在 bun + tsc 下
      // 会有名义不匹配；这里用结构化窄类型规避——我们只用三个字段
      entries = (await readdir(dir, { withFileTypes: true })) as unknown as Array<{
        name: string;
        isDirectory: () => boolean;
        isFile: () => boolean;
      }>;
    } catch {
      return;
    }
    for (const entry of entries) {
      const child = join(dir, entry.name);
      if (entry.isDirectory()) {
        // 跳过常见的不必要目录，避免进 node_modules / .git 等海量噪声
        if (entry.name === "node_modules" || entry.name === ".git") continue;
        await visitDir(child);
      } else if (entry.isFile()) {
        await grepFile(child);
      }
    }
  };

  const root = await stat(opts.path);
  if (root.isFile()) {
    await grepFile(opts.path);
  } else if (root.isDirectory()) {
    await visitDir(opts.path);
  } else {
    throw new Error(`path is neither file nor directory: ${opts.path}`);
  }
  return hits;
}
