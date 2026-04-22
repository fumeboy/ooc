/**
 * testable —— 测试运行 kernel trait
 *
 * 提供 LLM 直接调用 `bun test` 的能力：
 * - run_tests：一次性运行，返回 pass/fail/skip + failures 明细
 * - watch_tests：启动 watch 模式，失败时通过 subscribeFailures 广播
 * - stop_watch：停止 watch 会话
 * - test_coverage：运行 --coverage，返回未覆盖文件摘要
 *
 * 底层依赖 `src/test/runner.ts`。
 */

import { toolOk, toolErr } from "../../../src/types/tool-result";
import type { ToolResult } from "../../../src/types/tool-result";
import type { TraitMethod } from "../../../src/types/index";
import {
  runTests,
  startWatch,
  stopWatch,
  listWatchIds,
  summarizeCoverage,
  type TestRunSummary,
} from "../../../src/test/runner";

/** ctx 的最小形态 */
type Ctx = { rootDir?: string };

/** run_tests：一次性运行 */
async function runTestsImpl(
  ctx: Ctx,
  {
    filter,
    coverage = false,
    timeoutMs = 120_000,
  }: { filter?: string; coverage?: boolean; timeoutMs?: number } = {},
): Promise<ToolResult<TestRunSummary>> {
  const cwd = ctx.rootDir ?? "";
  if (!cwd) return toolErr("rootDir 未设置");
  try {
    const summary = await runTests({ cwd, filter, coverage, timeoutMs });
    return toolOk(summary);
  } catch (err: any) {
    return toolErr(`run_tests 失败: ${err?.message ?? String(err)}`);
  }
}

/** watch_tests：启动 watch，返回 watchId */
async function watchTestsImpl(
  ctx: Ctx,
  { filter }: { filter?: string } = {},
): Promise<ToolResult<{ watchId: string; startedAt: number }>> {
  const cwd = ctx.rootDir ?? "";
  if (!cwd) return toolErr("rootDir 未设置");
  try {
    const s = startWatch({ cwd, filter });
    return toolOk({ watchId: s.watchId, startedAt: s.startedAt });
  } catch (err: any) {
    return toolErr(`watch_tests 失败: ${err?.message ?? String(err)}`);
  }
}

/** stop_watch */
async function stopWatchImpl(
  _ctx: Ctx,
  { watchId }: { watchId: string },
): Promise<ToolResult<{ stopped: boolean }>> {
  if (!watchId) return toolErr("watchId 必填");
  try {
    const stopped = await stopWatch(watchId);
    return toolOk({ stopped });
  } catch (err: any) {
    return toolErr(`stop_watch 失败: ${err?.message ?? String(err)}`);
  }
}

/** list_watches */
async function listWatchesImpl(
  _ctx: Ctx,
  _args: Record<string, never> = {} as Record<string, never>,
): Promise<ToolResult<{ watchIds: string[] }>> {
  return toolOk({ watchIds: listWatchIds() });
}

/** test_coverage：跑一次 --coverage 并返回摘要 */
async function testCoverageImpl(
  ctx: Ctx,
  { filter }: { filter?: string } = {},
): Promise<
  ToolResult<{ pass: number; fail: number; coveragePct?: number; summary: string }>
> {
  const cwd = ctx.rootDir ?? "";
  if (!cwd) return toolErr("rootDir 未设置");
  try {
    const s = await runTests({ cwd, filter, coverage: true });
    const summary = summarizeCoverage(s.raw);
    return toolOk({
      pass: s.pass,
      fail: s.fail,
      coveragePct: s.coveragePct,
      summary,
    });
  } catch (err: any) {
    return toolErr(`test_coverage 失败: ${err?.message ?? String(err)}`);
  }
}

/* ========== 位置参数导出（测试用） ========== */

export const run_tests = (ctx: any, opts?: { filter?: string; coverage?: boolean; timeoutMs?: number }) =>
  runTestsImpl(ctx, opts);

export const watch_tests = (ctx: any, opts?: { filter?: string }) =>
  watchTestsImpl(ctx, opts);

export const stop_watch = (ctx: any, watchId: string) => stopWatchImpl(ctx, { watchId });

export const list_watches = (ctx: any) => listWatchesImpl(ctx);

export const test_coverage = (ctx: any, opts?: { filter?: string }) =>
  testCoverageImpl(ctx, opts);

/* ========== Phase 2 llm_methods ========== */

export const llm_methods: Record<string, TraitMethod> = {
  run_tests: {
    name: "run_tests",
    description: "一次性运行 bun test，返回 pass/fail/skip + 失败明细",
    params: [
      { name: "filter", type: "string", description: "测试文件/名称过滤", required: false },
      { name: "coverage", type: "boolean", description: "是否开 --coverage", required: false },
      { name: "timeoutMs", type: "number", description: "超时（默认 120000ms）", required: false },
    ],
    fn: runTestsImpl as TraitMethod["fn"],
  },
  watch_tests: {
    name: "watch_tests",
    description: "启动 bun test --watch，失败自动广播（通过 subscribeFailures）",
    params: [
      { name: "filter", type: "string", description: "测试文件/名称过滤", required: false },
    ],
    fn: watchTestsImpl as TraitMethod["fn"],
  },
  stop_watch: {
    name: "stop_watch",
    description: "停止 watch 会话",
    params: [{ name: "watchId", type: "string", description: "watch id", required: true }],
    fn: stopWatchImpl as TraitMethod["fn"],
  },
  list_watches: {
    name: "list_watches",
    description: "列出所有活跃 watch id",
    params: [],
    fn: listWatchesImpl as TraitMethod["fn"],
  },
  test_coverage: {
    name: "test_coverage",
    description: "运行测试并生成覆盖率摘要",
    params: [
      { name: "filter", type: "string", description: "测试过滤", required: false },
    ],
    fn: testCoverageImpl as TraitMethod["fn"],
  },
};

export const ui_methods: Record<string, TraitMethod> = {};
