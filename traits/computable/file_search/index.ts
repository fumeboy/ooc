/**
 * file_search —— 文件搜索 kernel trait（Phase 2 协议：llm_methods 对象导出）
 *
 * 提供文件名模式匹配（glob）和文件内容搜索（grep）能力。
 * 所有返回路径均为相对于 rootDir 的相对路径，保持输出紧凑。
 */

import { resolve, relative } from "path";
import { toolOk, toolErr } from "../../../src/shared/types/tool-result";
import type { ToolResult } from "../../../src/shared/types/tool-result";
import type { TraitMethod } from "../../../src/shared/types/index";

/** 默认忽略的目录列表 */
const DEFAULT_IGNORE = ["node_modules", ".git", ".存档"];

/**
 * 按文件名模式匹配搜索文件
 */
async function globImpl(
  ctx: { rootDir?: string },
  {
    pattern,
    basePath,
    limit = 50,
    ignore = DEFAULT_IGNORE,
  }: { pattern: string; basePath?: string; limit?: number; ignore?: string[] },
): Promise<ToolResult<string[]>> {
  const base = basePath
    ? basePath.startsWith("/")
      ? basePath
      : resolve(ctx.rootDir ?? "", basePath)
    : (ctx.rootDir ?? "");

  try {
    const g = new Bun.Glob(pattern);
    const results: string[] = [];

    for await (const entry of g.scan({ cwd: base })) {
      const shouldIgnore = ignore.some(
        (dir) => entry.startsWith(dir + "/") || entry.includes("/" + dir + "/"),
      );
      if (shouldIgnore) continue;
      results.push(entry);
      if (results.length >= limit) break;
    }

    return toolOk(results);
  } catch (err: any) {
    return toolErr(`glob 搜索失败: ${err?.message ?? String(err)}`);
  }
}

/** grep 输出的单条匹配结果 */
interface GrepMatch {
  file: string;
  line: number;
  content: string;
}

/**
 * 在文件内容中搜索匹配的文本行
 */
async function grepImpl(
  ctx: { rootDir?: string },
  {
    pattern,
    path,
    glob,
    context,
    maxResults = 30,
    ignoreCase = false,
  }: {
    pattern: string;
    path?: string;
    glob?: string;
    context?: number;
    maxResults?: number;
    ignoreCase?: boolean;
  },
): Promise<ToolResult<GrepMatch[]>> {
  const searchPath = path
    ? path.startsWith("/")
      ? path
      : resolve(ctx.rootDir ?? "", path)
    : (ctx.rootDir ?? "");

  try {
    const args: string[] = ["-r", "-n"];

    if (ignoreCase) args.push("-i");
    if (context && context > 0) args.push(`-C`, String(context));
    if (glob) args.push(`--include=${glob}`);
    for (const dir of DEFAULT_IGNORE) args.push(`--exclude-dir=${dir}`);
    args.push(`-m`, String(maxResults));
    args.push("--", pattern, searchPath);

    const proc = Bun.spawn(["grep", ...args], { stdout: "pipe", stderr: "pipe" });
    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    await proc.exited;

    if (proc.exitCode !== 0 && proc.exitCode !== 1) {
      return toolErr(`grep 执行失败: ${stderr.trim()}`);
    }

    const rootDir = ctx.rootDir ?? "";
    const matches: GrepMatch[] = [];
    const lines = stdout.split("\n").filter((l) => l.length > 0);

    for (const line of lines) {
      if (line === "--") continue;
      const match = line.match(/^(.+?):(\d+)[:：](.*)$/);
      if (match) {
        const filePath = match[1]!;
        const lineNum = parseInt(match[2]!, 10);
        const content = match[3]!;
        const relPath = rootDir ? relative(rootDir, filePath) : filePath;

        matches.push({ file: relPath, line: lineNum, content: content.trim() });
        if (matches.length >= maxResults) break;
      }
    }

    return toolOk(matches);
  } catch (err: any) {
    return toolErr(`grep 搜索失败: ${err?.message ?? String(err)}`);
  }
}

/* ========== 兼容导出（位置参数）：单元测试和内部调用用 ========== */

export const glob = (
  ctx: any,
  pattern: string,
  options?: { basePath?: string; limit?: number; ignore?: string[] },
) =>
  globImpl(ctx, {
    pattern,
    basePath: options?.basePath,
    limit: options?.limit,
    ignore: options?.ignore,
  });

export const grep = (
  ctx: any,
  pattern: string,
  options?: {
    path?: string;
    glob?: string;
    context?: number;
    maxResults?: number;
    ignoreCase?: boolean;
  },
) =>
  grepImpl(ctx, {
    pattern,
    path: options?.path,
    glob: options?.glob,
    context: options?.context,
    maxResults: options?.maxResults,
    ignoreCase: options?.ignoreCase,
  });

/* ========== Phase 2 新协议 ========== */

export const llm_methods: Record<string, TraitMethod> = {
  glob: {
    name: "glob",
    description: "按文件名模式匹配搜索文件",
    params: [
      { name: "pattern", type: "string", description: 'glob 模式（如 "**/*.ts"）', required: true },
      { name: "basePath", type: "string", description: "搜索根目录（默认 rootDir）", required: false },
      { name: "limit", type: "number", description: "最大返回数量（默认 50）", required: false },
      { name: "ignore", type: "string[]", description: "忽略的目录列表", required: false },
    ],
    fn: globImpl as TraitMethod["fn"],
  },
  grep: {
    name: "grep",
    description: "在文件内容中搜索匹配的文本行",
    params: [
      { name: "pattern", type: "string", description: "搜索文本或正则", required: true },
      { name: "path", type: "string", description: "搜索目录（默认 rootDir）", required: false },
      { name: "glob", type: "string", description: '文件名过滤（如 "*.ts"）', required: false },
      { name: "context", type: "number", description: "上下文行数", required: false },
      { name: "maxResults", type: "number", description: "最大结果数（默认 30）", required: false },
      { name: "ignoreCase", type: "boolean", description: "忽略大小写", required: false },
    ],
    fn: grepImpl as TraitMethod["fn"],
  },
};

export const ui_methods: Record<string, TraitMethod> = {};
