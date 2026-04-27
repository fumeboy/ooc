/**
 * shell_exec —— Shell 命令执行 kernel trait（Phase 2 协议：llm_methods 对象导出）
 *
 * 提供 Shell 命令执行能力，支持自定义工作目录、超时和环境变量。
 */

import type { TraitMethod } from "../../../src/shared/types/index";

/** exec 方法的可选参数 */
export interface ExecOptions {
  cwd?: string;
  timeout?: number;
  env?: Record<string, string>;
  allowNonZero?: boolean;
}

interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
}

/**
 * Shell 执行错误
 */
export class ExecError extends Error {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
  readonly timedOut: boolean;

  constructor(result: ExecResult) {
    const errorLines: string[] = [];
    errorLines.push(`执行失败 (exit code: ${result.exitCode})`);
    if (result.stderr) errorLines.push(`stderr: ${result.stderr}`);
    if (result.timedOut) errorLines.push(`(执行超时)`);
    super(errorLines.join("\n"));
    this.name = "ExecError";
    this.stdout = result.stdout;
    this.stderr = result.stderr;
    this.exitCode = result.exitCode;
    this.timedOut = result.timedOut;
  }
}

const MAX_TIMEOUT = 600_000;
const DEFAULT_TIMEOUT = 120_000;

async function execImpl(
  ctx: { rootDir?: string },
  {
    command,
    cwd,
    timeout,
    env,
    allowNonZero,
  }: { command: string; cwd?: string; timeout?: number; env?: Record<string, string>; allowNonZero?: boolean },
): Promise<string> {
  const workCwd = cwd ?? ctx.rootDir ?? process.cwd();
  const t = Math.min(timeout ?? DEFAULT_TIMEOUT, MAX_TIMEOUT);
  const fullEnv = env ? { ...process.env, ...env } : process.env;

  try {
    const proc = Bun.spawn(["sh", "-c", command], {
      cwd: workCwd,
      env: fullEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill();
    }, t);

    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    const exitCode = await proc.exited;
    clearTimeout(timer);

    let result: ExecResult = { stdout, stderr, exitCode, timedOut };

    if ((exitCode !== 0 && !allowNonZero) || timedOut) {
      if (!timedOut && exitCode === 1 && !stderr.trim() && /\b(grep|rg)\b/.test(command)) {
        result = {
          ...result,
          stderr:
            "(提示) grep/rg 无匹配时通常 exit code = 1。若你只是想判断是否存在匹配，可传入 allowNonZero: true 并自行解析 stdout。",
        };
      }
      throw new ExecError(result);
    }

    return stdout;
  } catch (err: any) {
    if (err instanceof ExecError) throw err;
    throw new ExecError({
      stdout: "",
      stderr: err?.message ?? String(err),
      exitCode: -1,
      timedOut: false,
    });
  }
}

async function shImpl(
  ctx: { rootDir?: string },
  {
    command,
    cwd,
    timeout,
    env,
  }: { command: string; cwd?: string; timeout?: number; env?: Record<string, string> },
): Promise<ExecResult & { ok: boolean }> {
  const workCwd = cwd ?? ctx.rootDir ?? process.cwd();
  const t = Math.min(timeout ?? DEFAULT_TIMEOUT, MAX_TIMEOUT);
  const fullEnv = env ? { ...process.env, ...env } : process.env;

  try {
    const proc = Bun.spawn(["sh", "-c", command], {
      cwd: workCwd,
      env: fullEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill();
    }, t);

    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    const exitCode = await proc.exited;
    clearTimeout(timer);

    return { stdout, stderr, exitCode, timedOut, ok: exitCode === 0 && !timedOut };
  } catch (err: any) {
    throw new ExecError({
      stdout: "",
      stderr: err?.message ?? String(err),
      exitCode: -1,
      timedOut: false,
    });
  }
}

/* ========== 兼容导出（位置参数）：单元测试和内部调用用 ========== */

export const exec = (ctx: any, command: string, options?: ExecOptions) =>
  execImpl(ctx, {
    command,
    cwd: options?.cwd,
    timeout: options?.timeout,
    env: options?.env,
    allowNonZero: options?.allowNonZero,
  });

export const sh = (ctx: any, command: string, options?: ExecOptions) =>
  shImpl(ctx, {
    command,
    cwd: options?.cwd,
    timeout: options?.timeout,
    env: options?.env,
  });

/* ========== Phase 2 新协议 ========== */

export const llm_methods: Record<string, TraitMethod> = {
  exec: {
    name: "exec",
    description: "执行 Shell 命令。非零 exit 或超时抛 ExecError",
    params: [
      { name: "command", type: "string", description: "shell 命令字符串", required: true },
      { name: "cwd", type: "string", description: "工作目录（默认 rootDir）", required: false },
      { name: "timeout", type: "number", description: "超时毫秒（默认 120000）", required: false },
      { name: "env", type: "object", description: "额外环境变量", required: false },
      { name: "allowNonZero", type: "boolean", description: "允许非 0 exit（默认 false）", required: false },
    ],
    fn: execImpl as TraitMethod["fn"],
  },
  sh: {
    name: "sh",
    description: "结构化执行 Shell 命令，返回 { stdout, stderr, exitCode, timedOut, ok }",
    params: [
      { name: "command", type: "string", description: "shell 命令", required: true },
      { name: "cwd", type: "string", description: "工作目录", required: false },
      { name: "timeout", type: "number", description: "超时毫秒", required: false },
      { name: "env", type: "object", description: "环境变量", required: false },
    ],
    fn: shImpl as TraitMethod["fn"],
  },
};

export const ui_methods: Record<string, TraitMethod> = {};
