import { describe, it, expect } from "bun:test";
import { LlmTimeoutError, withLlmTimeout, readLlmTimeoutMs, resolveLlmTimeoutMs } from "../timeout";

describe("withLlmTimeout", () => {
  it("resolves when promise finishes within timeout", async () => {
    const r = await withLlmTimeout(Promise.resolve(42), 100);
    expect(r).toBe(42);
  });

  it("throws LlmTimeoutError when promise hangs past timeout", async () => {
    const hang = new Promise((resolve) => setTimeout(() => resolve("late"), 200));
    await expect(withLlmTimeout(hang, 30)).rejects.toBeInstanceOf(LlmTimeoutError);
  });

  it("readLlmTimeoutMs honors OOC_LLM_TIMEOUT_MS env", () => {
    const prev = process.env.OOC_LLM_TIMEOUT_MS;
    process.env.OOC_LLM_TIMEOUT_MS = "5000";
    try {
      expect(readLlmTimeoutMs()).toBe(5000);
    } finally {
      if (prev === undefined) delete process.env.OOC_LLM_TIMEOUT_MS;
      else process.env.OOC_LLM_TIMEOUT_MS = prev;
    }
  });

  it("readLlmTimeoutMs falls back to default for invalid value", () => {
    const prev = process.env.OOC_LLM_TIMEOUT_MS;
    process.env.OOC_LLM_TIMEOUT_MS = "not-a-number";
    try {
      expect(readLlmTimeoutMs()).toBeGreaterThan(0);
    } finally {
      if (prev === undefined) delete process.env.OOC_LLM_TIMEOUT_MS;
      else process.env.OOC_LLM_TIMEOUT_MS = prev;
    }
  });
});

describe("resolveLlmTimeoutMs (任务级覆盖, 根因 #1)", () => {
  it("任务级 override 生效 (合法正数优先于全局默认)", () => {
    const prev = process.env.OOC_LLM_TIMEOUT_MS;
    delete process.env.OOC_LLM_TIMEOUT_MS; // 确保全局是 120s 默认
    try {
      expect(resolveLlmTimeoutMs(600_000)).toBe(600_000);
    } finally {
      if (prev === undefined) delete process.env.OOC_LLM_TIMEOUT_MS;
      else process.env.OOC_LLM_TIMEOUT_MS = prev;
    }
  });

  it("缺省 (undefined override) 回落全局默认 120s", () => {
    const prev = process.env.OOC_LLM_TIMEOUT_MS;
    delete process.env.OOC_LLM_TIMEOUT_MS;
    try {
      expect(resolveLlmTimeoutMs(undefined)).toBe(120_000);
    } finally {
      if (prev === undefined) delete process.env.OOC_LLM_TIMEOUT_MS;
      else process.env.OOC_LLM_TIMEOUT_MS = prev;
    }
  });

  it("非法 override (0 / 负数 / NaN) 回落全局默认, 不静默吞", () => {
    const prev = process.env.OOC_LLM_TIMEOUT_MS;
    delete process.env.OOC_LLM_TIMEOUT_MS;
    try {
      expect(resolveLlmTimeoutMs(0)).toBe(120_000);
      expect(resolveLlmTimeoutMs(-5)).toBe(120_000);
      expect(resolveLlmTimeoutMs(Number.NaN)).toBe(120_000);
    } finally {
      if (prev === undefined) delete process.env.OOC_LLM_TIMEOUT_MS;
      else process.env.OOC_LLM_TIMEOUT_MS = prev;
    }
  });

  it("override 优先于全局 env (任务级不被 env 全局值覆盖)", () => {
    const prev = process.env.OOC_LLM_TIMEOUT_MS;
    process.env.OOC_LLM_TIMEOUT_MS = "5000";
    try {
      expect(resolveLlmTimeoutMs(300_000)).toBe(300_000); // 任务级赢
      expect(resolveLlmTimeoutMs(undefined)).toBe(5000); // 缺省回落到 env
    } finally {
      if (prev === undefined) delete process.env.OOC_LLM_TIMEOUT_MS;
      else process.env.OOC_LLM_TIMEOUT_MS = prev;
    }
  });
});
