import { describe, it, expect } from "bun:test";
import { LlmTimeoutError, withLlmTimeout, readLlmTimeoutMs } from "../timeout";

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
