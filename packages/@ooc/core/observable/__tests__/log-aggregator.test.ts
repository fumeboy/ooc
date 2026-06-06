import { beforeEach, describe, expect, spyOn, test } from "bun:test";
import {
  observeWarn,
  observeLog,
  logPatternSnapshot,
  __resetLogAggregator,
} from "../log-aggregator";

// beforeEach（非 afterEach）：log-aggregator 是进程级模块状态，bun 同进程跑多测试文件时
// 其它文件的 observeWarn（如 readThread 警告）会污染 patterns；每个用例前复位保证干净。
beforeEach(() => __resetLogAggregator());

describe("log-aggregator", () => {
  test("去重计数：同 key 多次只累加一个 pattern", () => {
    for (let i = 0; i < 370; i++) {
      observeWarn("readThread.missing-object", `missing object obj${i % 3}`, 1000 + i);
    }
    const snap = logPatternSnapshot();
    expect(snap).toHaveLength(1);
    expect(snap[0]!.key).toBe("readThread.missing-object");
    expect(snap[0]!.count).toBe(370);
    expect(snap[0]!.firstTs).toBe(1000);
    expect(snap[0]!.lastTs).toBe(1000 + 369);
    expect(snap[0]!.sample).toContain("missing object"); // 保留最近完整消息
  });

  test("限流：370 次重复只实际输出 首3 + 每100 = 6 行（而非 370 行刷屏）", () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      for (let i = 0; i < 370; i++) {
        observeWarn("k", "spam", 1000 + i);
      }
      // 输出于 count = 1,2,3,100,200,300 → 6 次
      expect(warn.mock.calls.length).toBe(6);
      // 采样输出带总数后缀
      const lastCall = warn.mock.calls[warn.mock.calls.length - 1]![0];
      expect(lastCall).toBe("spam (×300)");
    } finally {
      warn.mockRestore();
    }
  });

  test("首条不带后缀，第 2 条起带 ×count", () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      observeWarn("k", "msg", 1);
      observeWarn("k", "msg", 2);
      expect(warn.mock.calls[0]![0]).toBe("msg");
      expect(warn.mock.calls[1]![0]).toBe("msg (×2)");
    } finally {
      warn.mockRestore();
    }
  });

  test("snapshot 按 count 降序 top-K", () => {
    observeWarn("low", "a", 1);
    for (let i = 0; i < 5; i++) observeWarn("high", "b", 1);
    for (let i = 0; i < 3; i++) observeWarn("mid", "c", 1);
    const snap = logPatternSnapshot(2);
    expect(snap.map((p) => p.key)).toEqual(["high", "mid"]);
  });

  test("level 路由到对应 console 方法", () => {
    const err = spyOn(console, "error").mockImplementation(() => {});
    try {
      observeLog("error", "e", "boom", 1);
      expect(err.mock.calls[0]![0]).toBe("boom");
    } finally {
      err.mockRestore();
    }
  });
});
