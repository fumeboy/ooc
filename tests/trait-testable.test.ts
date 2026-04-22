/**
 * testable trait 形态验证
 *
 * 不真跑 `bun test`（子进程递归 + 慢）；只验：
 * 1. llm_methods 导出完整
 * 2. list_watches / stop_watch 的边界行为
 */

import { describe, test, expect } from "bun:test";
import {
  llm_methods,
  list_watches,
  stop_watch,
  run_tests,
} from "../traits/computable/testable/index";

describe("testable trait shape", () => {
  test("llm_methods 导出 5 个方法", () => {
    const names = Object.keys(llm_methods);
    expect(names).toContain("run_tests");
    expect(names).toContain("watch_tests");
    expect(names).toContain("stop_watch");
    expect(names).toContain("list_watches");
    expect(names).toContain("test_coverage");
  });

  test("每个方法有 name/description/params/fn", () => {
    for (const m of Object.values(llm_methods)) {
      expect(typeof m.name).toBe("string");
      expect(typeof m.description).toBe("string");
      expect(Array.isArray(m.params)).toBe(true);
      expect(typeof m.fn).toBe("function");
    }
  });
});

describe("list_watches / stop_watch 边界", () => {
  test("list_watches 初始为空", async () => {
    const r = await list_watches({});
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(Array.isArray(r.data.watchIds)).toBe(true);
  });

  test("stop_watch 不存在的 id 返回 { stopped: false }", async () => {
    const r = await stop_watch({}, "bogus_id");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.stopped).toBe(false);
  });

  test("stop_watch 空 id 报错", async () => {
    const r = await stop_watch({}, "");
    expect(r.ok).toBe(false);
  });

  test("run_tests 缺 rootDir 报错", async () => {
    const r = await run_tests({});
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain("rootDir");
  });
});
