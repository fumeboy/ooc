/**
 * shell_exec —— Shell 命令执行 kernel trait
 *
 * 提供 Shell 命令执行能力，支持自定义工作目录、超时和环境变量。
 * 命令通过 sh -c 执行，支持管道、重定向等 Shell 特性。
 */

import { toolOk, toolErr } from "../../src/types/tool-result";
import type { ToolResult } from "../../src/types/tool-result";

/** exec 方法的可选参数 */
interface ExecOptions {
  /** 工作目录（默认为 ctx.rootDir） */
  cwd?: string;
  /** 超时毫秒数（默认 120000，最大 600000） */
  timeout?: number;
  /** 额外环境变量 */
  env?: Record<string, string>;
}

/** exec 方法的返回数据 */
interface ExecResult {
  /** 标准输出 */
  stdout: string;
  /** 标准错误 */
  stderr: string;
  /** 退出码 */
  exitCode: number;
  /** 是否因超时被终止 */
  timedOut: boolean;
}

/** 最大允许超时：600 秒 */
const MAX_TIMEOUT = 600_000;
/** 默认超时：120 秒 */
const DEFAULT_TIMEOUT = 120_000;

/**
 * 执行 Shell 命令
 * @param ctx - 上下文（需要 ctx.rootDir）
 * @param command - 要执行的 Shell 命令
 * @param options - 可选参数：cwd、timeout、env
 * @returns 包含 stdout、stderr、exitCode、timedOut 的结果
 */
export async function exec(
  ctx: any,
  command: string,
  options?: ExecOptions,
): Promise<ToolResult<ExecResult>> {
  const cwd = options?.cwd ?? ctx.rootDir ?? process.cwd();
  const timeout = Math.min(options?.timeout ?? DEFAULT_TIMEOUT, MAX_TIMEOUT);
  const env = options?.env
    ? { ...process.env, ...options.env }
    : process.env;

  try {
    const proc = Bun.spawn(["sh", "-c", command], {
      cwd,
      env,
      stdout: "pipe",
      stderr: "pipe",
    });

    let timedOut = false;

    // 超时处理：到时间后强制终止进程
    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill();
    }, timeout);

    // 并行读取 stdout/stderr 并等待进程退出
    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    const exitCode = await proc.exited;

    clearTimeout(timer);

    return toolOk({
      stdout,
      stderr,
      exitCode,
      timedOut,
    });
  } catch (err: any) {
    return toolErr(`执行命令失败: ${err?.message ?? String(err)}`);
  }
}
