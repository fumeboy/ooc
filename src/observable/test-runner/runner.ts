/**
 * TestRunner —— 测试运行器封装
 *
 * 目标：
 * 1. 封装 `bun test` 的一次性运行与 --watch 模式
 * 2. 解析输出提取失败测试（name + file:line + stack）
 * 3. 提供可订阅的失败事件（listener 注册 / 卸载）
 * 4. 解析 coverage 摘要（bun test --coverage）
 *
 * 不负责：
 * - 把失败投递到 world.talk（由上层路由器桥接，runner 只广播事件）
 *
 * @ref docs/工程管理/迭代/all/20260422_feature_test_watch.md
 */

import { spawn, type Subprocess } from "bun";

/** 单个失败测试 */
export interface TestFailure {
  /** 测试名（describe > test 路径） */
  name: string;
  /** 源文件路径（若 bun 输出里能解析到） */
  file?: string;
  /** 行号 */
  line?: number;
  /** 错误消息（stack 首行） */
  message?: string;
  /** 原始完整片段（给 LLM 读） */
  raw: string;
}

/** 一次 run 的汇总 */
export interface TestRunSummary {
  /** 通过数 */
  pass: number;
  /** 失败数 */
  fail: number;
  /** skip 数 */
  skip: number;
  /** 失败明细 */
  failures: readonly TestFailure[];
  /** exit code */
  exitCode: number;
  /** stdout + stderr 合并的原始输出（用于 LLM 深追） */
  raw: string;
  /** 运行耗时毫秒 */
  durationMs: number;
  /** coverage 百分比（若 --coverage 且解析到） */
  coveragePct?: number;
}

/** 运行配置 */
export interface RunOptions {
  /** 运行目录（cwd） */
  cwd: string;
  /** 可选的 filter 字符串（bun test <filter>） */
  filter?: string;
  /** 是否开 --coverage */
  coverage?: boolean;
  /** 运行超时（ms，默认 120s） */
  timeoutMs?: number;
}

/** watch 会话 */
export interface WatchSession {
  /** watch id */
  watchId: string;
  /** 启动时刻 */
  startedAt: number;
  /** cwd */
  cwd: string;
  /** 停止 */
  stop(): Promise<void>;
  /** 是否已停止 */
  stopped: boolean;
}

/** 失败事件监听器 */
export type FailureListener = (failures: readonly TestFailure[], cwd: string) => void;

/* ========== 输出解析 ========== */

/**
 * 从 bun test 输出里解析 summary 行
 *
 * bun test 输出样例：
 *   606 pass
 *   6 skip
 *   0 fail
 *   1624 expect() calls
 *   Ran 612 tests across 59 files. [2.08s]
 */
export function parseSummary(raw: string): { pass: number; fail: number; skip: number } {
  const passMatch = raw.match(/\n\s*(\d+)\s+pass\b/);
  const failMatch = raw.match(/\n\s*(\d+)\s+fail\b/);
  const skipMatch = raw.match(/\n\s*(\d+)\s+skip\b/);
  return {
    pass: passMatch ? parseInt(passMatch[1]!, 10) : 0,
    fail: failMatch ? parseInt(failMatch[1]!, 10) : 0,
    skip: skipMatch ? parseInt(skipMatch[1]!, 10) : 0,
  };
}

/**
 * 提取失败测试
 *
 * bun 对失败测试的输出形态（简化样例）：
 *
 *   (fail) describe > subdescribe > test name [0.52ms]
 *   ... 上方可能有 stack / error message ...
 *
 * 或者更详细的：
 *
 *   path/to/file.test.ts:
 *   123 |   expect(x).toBe(1);
 *                    ^
 *   error: ...
 *       at <anonymous> (path/to/file.test.ts:123:17)
 *   (fail) describe > test [0.52ms]
 *
 * 解析策略：
 * - 每行找 `(fail)` 标记，提取后面的测试名（到 `[` 前）
 * - 向上回溯最近的 `error:` / `expect()` 块作为 raw
 * - 从 raw 中用 `(.+?):(\d+):` 匹配第一个文件引用作为 file/line
 */
export function parseFailures(raw: string): TestFailure[] {
  const failures: TestFailure[] = [];
  const lines = raw.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const m = line.match(/^\s*\(fail\)\s+(.+?)(?:\s*\[[^\]]*\])?\s*$/);
    if (!m) continue;

    const name = m[1]!.trim();
    // 回溯收集上下文：从当前行往前最多 40 行或遇到空行/另一个 (fail)/(pass)
    const context: string[] = [];
    for (let j = i - 1; j >= Math.max(0, i - 40); j--) {
      const prev = lines[j]!;
      if (/^\s*\((?:fail|pass|skip)\)/.test(prev)) break;
      context.unshift(prev);
    }
    const blob = [...context, line].join("\n");

    // 找 error message
    let message: string | undefined;
    const errMatch = blob.match(/^\s*error:\s*(.+)$/m);
    if (errMatch) message = errMatch[1]!.trim();

    // 找 file:line
    let file: string | undefined;
    let lineNum: number | undefined;
    const fileMatch = blob.match(/([A-Za-z0-9_\-./]+\.(?:test|spec)\.[tj]sx?):(\d+)/);
    if (fileMatch) {
      file = fileMatch[1]!;
      lineNum = parseInt(fileMatch[2]!, 10);
    }

    failures.push({ name, file, line: lineNum, message, raw: blob });
  }

  return failures;
}

/** 尝试从 `bun test --coverage` 输出里拿总覆盖率百分比 */
export function parseCoverage(raw: string): number | undefined {
  // bun 的 coverage 表格最后会有 "All files   |  XX.XX |" 样的行
  const m = raw.match(/^\s*All files[^\n]*?(\d+(?:\.\d+)?)/m);
  if (!m) return undefined;
  const n = parseFloat(m[1]!);
  return Number.isFinite(n) ? n : undefined;
}

/* ========== 运行入口 ========== */

/**
 * 一次性运行
 */
export async function runTests(opts: RunOptions): Promise<TestRunSummary> {
  const started = Date.now();
  const args = ["test"];
  if (opts.coverage) args.push("--coverage");
  if (opts.filter) args.push(opts.filter);

  const proc = spawn(["bun", ...args], {
    cwd: opts.cwd,
    stdout: "pipe",
    stderr: "pipe",
  });

  // 超时控制
  const timeoutMs = opts.timeoutMs ?? 120_000;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      try {
        proc.kill();
      } catch {
        // ignore
      }
      reject(new Error(`runTests 超时 ${timeoutMs}ms`));
    }, timeoutMs);
  });

  try {
    const [stdoutText, stderrText] = await Promise.race([
      Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]),
      timeoutPromise,
    ]);
    await proc.exited;
    if (timer) clearTimeout(timer);

    const raw = stdoutText + "\n" + stderrText;
    const summary = parseSummary(raw);
    const failures = parseFailures(raw);
    const coveragePct = opts.coverage ? parseCoverage(raw) : undefined;
    /* 记录最近 coverage 快照，供 context-builder 注入 knowledge */
    if (opts.coverage) recordLatestCoverage(opts.cwd, raw, coveragePct);
    return {
      pass: summary.pass,
      fail: summary.fail,
      skip: summary.skip,
      failures: Object.freeze(failures),
      exitCode: proc.exitCode ?? 0,
      raw,
      durationMs: Date.now() - started,
      coveragePct,
    };
  } catch (err: any) {
    if (timer) clearTimeout(timer);
    throw err;
  }
}

/* ========== Watch 模式 ========== */

/** 全局 watch session 表 */
const watchSessions = new Map<string, WatchSession>();
/** 失败监听器 */
const failureListeners = new Set<FailureListener>();

/** 注册失败监听 */
export function subscribeFailures(listener: FailureListener): () => void {
  failureListeners.add(listener);
  return () => failureListeners.delete(listener);
}

/** 广播失败 */
function broadcastFailures(failures: readonly TestFailure[], cwd: string): void {
  for (const l of failureListeners) {
    try {
      l(failures, cwd);
    } catch {
      // 吞掉 listener 抛出的错，不影响其他 listener
    }
  }
}

/**
 * 测试 / 手动触发用：以指定 failures 列表触发所有已注册的 subscribeFailures 回调
 *
 * 仅供单元测试与集成测试调用（runner-world 桥无法等真 bun test 跑出假失败）。
 */
export function __emitFailuresForTest(failures: readonly TestFailure[], cwd: string): void {
  broadcastFailures(failures, cwd);
}

function newWatchId(): string {
  return `w_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * 启动 watch 会话
 */
export function startWatch(opts: {
  cwd: string;
  filter?: string;
}): WatchSession {
  const args = ["test", "--watch"];
  if (opts.filter) args.push(opts.filter);

  const proc = spawn(["bun", ...args], {
    cwd: opts.cwd,
    stdout: "pipe",
    stderr: "pipe",
  });

  const watchId = newWatchId();
  let stopped = false;
  let buffer = "";

  // 读 stdout，累积到遇到 summary 行时触发解析
  const drainStdout = async () => {
    try {
      for await (const chunk of proc.stdout) {
        const text = new TextDecoder().decode(chunk as Uint8Array);
        buffer += text;
        // 简化触发：看到 "fail\n" 或 "pass\n" 的 summary 片段就解析并清空
        if (/\n\s*\d+\s+fail\b/.test(buffer)) {
          const failures = parseFailures(buffer);
          if (failures.length > 0) broadcastFailures(failures, opts.cwd);
          buffer = "";
        }
      }
    } catch {
      // 进程被 kill 时读流会报错，安静吞掉
    }
  };
  drainStdout();

  const session: WatchSession = {
    watchId,
    startedAt: Date.now(),
    cwd: opts.cwd,
    stopped: false,
    async stop() {
      if (stopped) return;
      stopped = true;
      session.stopped = true;
      try {
        proc.kill();
        await proc.exited;
      } catch {
        // ignore
      }
      watchSessions.delete(watchId);
    },
  };
  watchSessions.set(watchId, session);
  return session;
}

/** 按 id 获取会话 */
export function getWatch(watchId: string): WatchSession | undefined {
  return watchSessions.get(watchId);
}

/** 停止某会话 */
export async function stopWatch(watchId: string): Promise<boolean> {
  const s = watchSessions.get(watchId);
  if (!s) return false;
  await s.stop();
  return true;
}

/** 测试工具：列出所有活跃 watch id */
export function listWatchIds(): string[] {
  return Array.from(watchSessions.keys());
}

/** 测试工具：清理所有 watch + listener + coverage 缓存 */
export async function __resetAll(): Promise<void> {
  for (const s of [...watchSessions.values()]) {
    await s.stop().catch(() => {});
  }
  watchSessions.clear();
  failureListeners.clear();
  latestCoverageByCwd.clear();
}

/* ========== Coverage 辅助 ========== */

/**
 * 从 bun test --coverage 输出里提取未覆盖的文件（简化）
 *
 * 返回格式化字符串供 context-builder 的 knowledge 窗口使用。
 */
export function summarizeCoverage(raw: string): string {
  // 找 coverage 表格的总行 + 若干低覆盖文件
  const lines = raw.split("\n");
  const tableLines: string[] = [];
  let inTable = false;
  for (const line of lines) {
    if (/^-+\|-+/.test(line)) {
      inTable = !inTable;
      continue;
    }
    if (inTable && line.includes("|")) {
      tableLines.push(line);
    }
  }
  if (tableLines.length === 0) return "";
  return tableLines.slice(0, 20).join("\n");
}

/* ========== Coverage 缓存（供 context-builder 注入 knowledge） ========== */

/**
 * 最近一次 coverage 运行结果快照
 *
 * 每次 runTests(opts.coverage=true) 成功返回时更新。
 * context-builder 读此缓存注入 `<knowledge name="coverage">`。
 * 若从未跑过 coverage，返回 undefined。
 */
export interface LatestCoverage {
  /** 总覆盖率百分比（未解析到则缺省） */
  pct?: number;
  /** 格式化后的未覆盖表摘要（给 LLM 看） */
  summary: string;
  /** 运行所在 cwd，便于多 repo 区分 */
  cwd: string;
  /** 更新时间戳 */
  updatedAt: number;
}

/** 最近一次 coverage（按 cwd 隔离） */
const latestCoverageByCwd = new Map<string, LatestCoverage>();

/** 更新最近 coverage 快照（内部调用） */
function recordLatestCoverage(cwd: string, raw: string, pct?: number): void {
  const summary = summarizeCoverage(raw);
  latestCoverageByCwd.set(cwd, {
    pct,
    summary,
    cwd,
    updatedAt: Date.now(),
  });
}

/**
 * 取最近一次 coverage 结果
 *
 * @param cwd - 可选按 cwd 过滤；不传则返回最近更新的那条
 */
export function getLatestCoverage(cwd?: string): LatestCoverage | undefined {
  if (cwd) return latestCoverageByCwd.get(cwd);
  let latest: LatestCoverage | undefined;
  for (const c of latestCoverageByCwd.values()) {
    if (!latest || c.updatedAt > latest.updatedAt) latest = c;
  }
  return latest;
}

/** 清除 coverage 缓存（测试 / reset 用） */
export function clearLatestCoverage(): void {
  latestCoverageByCwd.clear();
}

/**
 * 测试用：直接喂入 coverage 缓存，避免依赖真跑 bun test 子进程
 *
 * 仅供单元测试 / 集成测试使用。
 */
export function __injectLatestCoverageForTest(cov: LatestCoverage): void {
  latestCoverageByCwd.set(cov.cwd, cov);
}
