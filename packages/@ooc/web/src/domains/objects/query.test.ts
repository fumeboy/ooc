/**
 * 非 stone object id 过滤 test
 *
 * 验证 `user` / `main` / 空串等非 stone object id 被前置过滤,
 * 不会触发 /api/stones/<id>/self 请求 → console.warn 一次 → fetchSelfFirstLine
 * 返回 null。真实 stone id 不受影响。
 */
import { describe, expect, it, beforeEach, afterEach, mock } from "bun:test";
import {
  __isLikelyStoneObjectIdForTest,
  fetchSelfFirstLine,
  __resetDisplayNameCacheForTest,
} from "./query";

describe("non-stone object id filter", () => {
  beforeEach(() => {
    __resetDisplayNameCacheForTest();
  });

  it("filters out known non-stone ids (user / main)", () => {
    expect(__isLikelyStoneObjectIdForTest("user")).toBe(false);
    expect(__isLikelyStoneObjectIdForTest("main")).toBe(false);
  });

  it("filters out empty / undefined", () => {
    expect(__isLikelyStoneObjectIdForTest(undefined)).toBe(false);
    expect(__isLikelyStoneObjectIdForTest("")).toBe(false);
  });

  it("allows real stone-shaped ids through", () => {
    expect(__isLikelyStoneObjectIdForTest("supervisor")).toBe(true);
    expect(__isLikelyStoneObjectIdForTest("feedback-tracker")).toBe(true);
    expect(__isLikelyStoneObjectIdForTest("custom-agent-x")).toBe(true);
  });

  it("fetchSelfFirstLine returns null for non-stone ids without HTTP call", async () => {
    let fetchCalled = false;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(async (..._args: unknown[]) => {
      fetchCalled = true;
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;

    try {
      const result = await fetchSelfFirstLine("user");
      expect(result).toBeNull();
      expect(fetchCalled).toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("fetchSelfFirstLine still hits HTTP for real stone ids", async () => {
    let fetchCalled = false;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(async (..._args: unknown[]) => {
      fetchCalled = true;
      return new Response(JSON.stringify({ text: "# Supervisor\n\n..." }), {
        status: 200,
      });
    }) as unknown as typeof fetch;

    try {
      const result = await fetchSelfFirstLine("supervisor");
      expect(fetchCalled).toBe(true);
      expect(result).toBe("Supervisor");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
