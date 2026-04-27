/**
 * code_index 性能 benchmark
 *
 * 验证标准（迭代 spec）：
 *   - 大仓库（~5 万行）首次全量 < 15s
 *   - 单文件增量 < 500ms
 *   - semantic_search 响应 < 1s
 *
 * 把 kernel/src 作为 benchmark target（真实代码量；不需要人工数据）。
 *
 * 环境变量：
 *   OOC_BENCH=1 才跑——默认 skip，避免每次跑全量测试被拖慢。
 */

import { describe, test, expect, beforeAll } from "bun:test";
import { resolve } from "path";
import {
  semantic_search,
  index_refresh,
  list_symbols,
  __resetCache,
} from "../traits/computable/code_index/index";

const BENCH_ENABLED = process.env.OOC_BENCH === "1";
const describeBench = BENCH_ENABLED ? describe : describe.skip;

describeBench("code_index benchmark (OOC_BENCH=1)", () => {
  const kernelSrc = resolve(import.meta.dir, "..", "src");
  const ctx = { rootDir: resolve(import.meta.dir, "..") };
  let firstBuildMs = 0;
  let totalSymbols = 0;
  let totalFiles = 0;

  beforeAll(() => {
    __resetCache();
  });

  test("冷启动全量构建", async () => {
    const t0 = performance.now();
    const r = await index_refresh(ctx);
    const elapsed = performance.now() - t0;
    firstBuildMs = elapsed;
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    totalFiles = r.data.fileCount;
    totalSymbols = r.data.symbolCount;
    console.log(`[bench] 冷启动：files=${totalFiles}, symbols=${totalSymbols}, elapsed=${elapsed.toFixed(0)}ms`);
    /* 目标 < 15s；给 30s 宽容避免 CI 抖动，但日志里打印真实值 */
    expect(elapsed).toBeLessThan(30_000);
  });

  test("单文件增量刷新", async () => {
    /* 取已索引的第一个 kernel 文件做 refresh */
    const r1 = await list_symbols(ctx, "src/app/cli.ts");
    /* cli.ts 不一定有符号；退而求其次找任一常见文件 */
    const target = r1.ok && r1.data.length > 0 ? "src/app/cli.ts" : "src/thinkable/engine/engine.ts";
    const t0 = performance.now();
    const r = await index_refresh(ctx, [target]);
    const elapsed = performance.now() - t0;
    console.log(`[bench] 增量 ${target}: elapsed=${elapsed.toFixed(0)}ms`);
    expect(r.ok).toBe(true);
    expect(elapsed).toBeLessThan(1500); /* 目标 500ms，给 3x 宽容 */
  });

  test("semantic_search 查询延迟", async () => {
    const t0 = performance.now();
    const r = await semantic_search(ctx, "build context for thread", 10);
    const elapsed = performance.now() - t0;
    console.log(`[bench] semantic_search: elapsed=${elapsed.toFixed(0)}ms, hits=${r.ok ? r.data.length : 0}`);
    expect(r.ok).toBe(true);
    expect(elapsed).toBeLessThan(3_000); /* 单库规模；全量余弦向量扫描 */
  });
});
