/**
 * file_search —— 文件搜索 kernel trait
 *
 * 提供文件名模式匹配（glob）和文件内容搜索（grep）能力，任何对象激活即可用。
 * 所有返回路径均为相对于 rootDir 的相对路径，保持输出紧凑。
 */

import { resolve, relative } from "path";
import { toolOk, toolErr } from "../../../src/types/tool-result";
import type { ToolResult } from "../../../src/types/tool-result";

/** 默认忽略的目录列表 */
const DEFAULT_IGNORE = ["node_modules", ".git", ".存档"];

/**
 * 按文件名模式匹配搜索文件
 * @param ctx - 上下文（需要 ctx.rootDir）
 * @param pattern - glob 模式（如 "**\/*.ts"）
 * @param options - 可选参数
 * @param options.basePath - 搜索根目录（默认 ctx.rootDir）
 * @param options.limit - 最大返回数量（默认 50）
 * @param options.ignore - 忽略的目录列表（默认 ["node_modules", ".git", ".存档"]）
 * @returns 匹配的相对路径列表
 */
export async function glob(
  ctx: any,
  pattern: string,
  options?: { basePath?: string; limit?: number; ignore?: string[] },
): Promise<ToolResult<string[]>> {
  const basePath = options?.basePath
    ? options.basePath.startsWith("/")
      ? options.basePath
      : resolve(ctx.rootDir ?? "", options.basePath)
    : (ctx.rootDir ?? "");
  const limit = options?.limit ?? 50;
  const ignore = options?.ignore ?? DEFAULT_IGNORE;

  try {
    const g = new Bun.Glob(pattern);
    const results: string[] = [];

    for await (const entry of g.scan({ cwd: basePath })) {
      // 检查是否在忽略目录中
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
  /** 文件路径（相对于 rootDir） */
  file: string;
  /** 行号 */
  line: number;
  /** 匹配行的内容 */
  content: string;
}

/**
 * 在文件内容中搜索匹配的文本行
 * @param ctx - 上下文（需要 ctx.rootDir）
 * @param pattern - 搜索文本或正则表达式模式
 * @param options - 可选参数
 * @param options.path - 搜索目录（默认 ctx.rootDir）
 * @param options.glob - 文件名过滤（如 "*.ts"）
 * @param options.context - 显示匹配行前后的上下文行数
 * @param options.maxResults - 最大返回结果数（默认 30）
 * @param options.ignoreCase - 是否忽略大小写（默认 false）
 * @returns 匹配结果列表
 */
export async function grep(
  ctx: any,
  pattern: string,
  options?: {
    path?: string;
    glob?: string;
    context?: number;
    maxResults?: number;
    ignoreCase?: boolean;
  },
): Promise<ToolResult<GrepMatch[]>> {
  const searchPath = options?.path
    ? options.path.startsWith("/")
      ? options.path
      : resolve(ctx.rootDir ?? "", options.path)
    : (ctx.rootDir ?? "");
  const maxResults = options?.maxResults ?? 30;

  try {
    // 构建 grep 命令参数
    const args: string[] = [
      "-r",  // 递归搜索
      "-n",  // 显示行号
    ];

    // 忽略大小写
    if (options?.ignoreCase) {
      args.push("-i");
    }

    // 上下文行数（使用 -C 参数时输出格式会变，这里只取匹配行）
    // 注意：带 context 时 grep 输出格式包含 "--" 分隔符，我们仍只解析 file:line:content
    if (options?.context && options.context > 0) {
      args.push(`-C`, String(options.context));
    }

    // 文件名过滤
    if (options?.glob) {
      args.push(`--include=${options.glob}`);
    }

    // 排除目录
    for (const dir of DEFAULT_IGNORE) {
      args.push(`--exclude-dir=${dir}`);
    }

    // 限制最大匹配数
    args.push(`-m`, String(maxResults));

    // 搜索模式和路径
    args.push("--", pattern, searchPath);

    const proc = Bun.spawn(["grep", ...args], {
      stdout: "pipe",
      stderr: "pipe",
    });

    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    await proc.exited;

    // grep 退出码 1 表示无匹配，不是错误
    if (proc.exitCode !== 0 && proc.exitCode !== 1) {
      return toolErr(`grep 执行失败: ${stderr.trim()}`);
    }

    // 解析输出
    const rootDir = ctx.rootDir ?? "";
    const matches: GrepMatch[] = [];
    const lines = stdout.split("\n").filter((l) => l.length > 0);

    for (const line of lines) {
      // 格式: file:line:content 或 file-line-content（context 模式下的非匹配行）
      // 跳过 context 分隔符 "--"
      if (line === "--") continue;

      // 匹配 file:line:content 格式（匹配行用 ":"）
      const match = line.match(/^(.+?):(\d+)[:：](.*)$/);
      if (match) {
        const filePath = match[1]!;
        const lineNum = parseInt(match[2]!, 10);
        const content = match[3]!;

        // 转为相对路径
        const relPath = rootDir
          ? relative(rootDir, filePath)
          : filePath;

        matches.push({
          file: relPath,
          line: lineNum,
          content: content.trim(),
        });

        if (matches.length >= maxResults) break;
      }
    }

    return toolOk(matches);
  } catch (err: any) {
    return toolErr(`grep 搜索失败: ${err?.message ?? String(err)}`);
  }
}
