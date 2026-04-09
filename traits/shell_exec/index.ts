/**
 * shell_exec —— Shell 命令执行 kernel trait
 *
 * 提供 Shell 命令执行能力，支持自定义工作目录、超时和环境变量。
 */

/** exec 方法的可选参数 */
export interface ExecOptions {
  /** 工作目录（默认为对象的 rootDir） */
  cwd?: string;
  /** 超时毫秒数（默认 120000，最大 600000） */
  timeout?: number;
  /** 额外环境变量 */
  env?: Record<string, string>;
  /** 允许非 0 exit code（默认 false）。用于 grep/rg 等“无匹配=1”的命令 */
  allowNonZero?: boolean;
}

/** exec 方法的返回数据（内部使用） */
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

/**
 * Shell 执行错误
 *
 * 当命令执行失败（非零 exitCode）或超时时抛出。
 * 包含完整的 stdout、stderr、exitCode 和 timedOut 信息。
 */
export class ExecError extends Error {
  /** 标准输出 */
  readonly stdout: string;
  /** 标准错误 */
  readonly stderr: string;
  /** 退出码 */
  readonly exitCode: number;
  /** 是否因超时被终止 */
  readonly timedOut: boolean;

  constructor(result: ExecResult) {
    const errorLines: string[] = [];
    errorLines.push(`执行失败 (exit code: ${result.exitCode})`);
    if (result.stderr) {
      errorLines.push(`stderr: ${result.stderr}`);
    }
    if (result.timedOut) {
      errorLines.push(`(执行超时)`);
    }
    super(errorLines.join("\n"));
    this.name = "ExecError";
    this.stdout = result.stdout;
    this.stderr = result.stderr;
    this.exitCode = result.exitCode;
    this.timedOut = result.timedOut;
  }
}

/** 最大允许超时：600 秒 */
const MAX_TIMEOUT = 600_000;
/** 默认超时：120 秒 */
const DEFAULT_TIMEOUT = 120_000;

/**
 * 执行 Shell 命令
 *
 * @param ctx - 执行上下文（需要 rootDir）
 * @param command - Shell 命令字符串
 * @param options - 可选参数（cwd、timeout、env）
 * @returns 命令的 stdout 输出
 * @throws ExecError 当命令执行失败（非零 exitCode）或超时时抛出
 */
export async function exec(
  ctx: any,
  command: string,
  options?: ExecOptions,
): Promise<string> {
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
    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill();
    }, timeout);

    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    const exitCode = await proc.exited;
    clearTimeout(timer);

    let result: ExecResult = {
      stdout,
      stderr,
      exitCode,
      timedOut,
    };

    // 非零 exitCode 或超时视为失败（allowNonZero=true 时不因 exitCode!=0 失败）
    if ((exitCode !== 0 && !options?.allowNonZero) || timedOut) {
      // 常见：grep/rg 无匹配时 exitCode=1 但不是“系统错误”
      if (!timedOut && exitCode === 1 && !stderr.trim() && /\b(grep|rg)\b/.test(command)) {
        result = {
          ...result,
          stderr: "(提示) grep/rg 无匹配时通常 exit code = 1。若你只是想判断是否存在匹配，可传入 { allowNonZero: true } 并自行解析 stdout。",
        };
      }
      throw new ExecError(result);
    }

    // 成功时返回 stdout
    return stdout;
  } catch (err: any) {
    if (err instanceof ExecError) {
      throw err;
    }

    // 其他错误（如 spawn 失败）
    throw new ExecError({
      stdout: "",
      stderr: err?.message ?? String(err),
      exitCode: -1,
      timedOut: false,
    });
  }
}

/**
 * 执行 Shell 命令（结构化返回，不因非 0 exit code 直接抛错）
 *
 * 适用于：grep/rg 等需要自行判断 exit code 的场景。
 */
export async function sh(
  ctx: any,
  command: string,
  options?: ExecOptions,
): Promise<ExecResult & { ok: boolean }> {
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
    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill();
    }, timeout);

    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    const exitCode = await proc.exited;
    clearTimeout(timer);

    return {
      stdout,
      stderr,
      exitCode,
      timedOut,
      ok: exitCode === 0 && !timedOut,
    };
  } catch (err: any) {
    throw new ExecError({
      stdout: "",
      stderr: err?.message ?? String(err),
      exitCode: -1,
      timedOut: false,
    });
  }
}
