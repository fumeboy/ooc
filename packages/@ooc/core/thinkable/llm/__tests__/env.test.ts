import { afterEach, describe, expect, it } from "bun:test";
import { readLlmEnv } from "../env.ts";

const KEYS = ["OOC_PROVIDER", "OOC_API_KEY", "OOC_BASE_URL", "OOC_MODEL"] as const;

afterEach(() => {
  for (const key of KEYS) {
    delete process.env[key];
  }
});

describe("readLlmEnv", () => {
  it("读取完整的 OOC 配置", () => {
    process.env.OOC_PROVIDER = "openai";
    process.env.OOC_API_KEY = "test-key";
    process.env.OOC_BASE_URL = "https://example.com/v1";
    process.env.OOC_MODEL = "gpt-test";

    expect(readLlmEnv()).toEqual({
      provider: "openai",
      apiKey: "test-key",
      baseUrl: "https://example.com/v1",
      model: "gpt-test"
    });
  });

  it("provider 非法时抛错", () => {
    process.env.OOC_PROVIDER = "glm";
    process.env.OOC_API_KEY = "test-key";
    process.env.OOC_BASE_URL = "https://example.com/v1";
    process.env.OOC_MODEL = "test-model";

    expect(() => readLlmEnv()).toThrow("OOC_PROVIDER");
  });

  it("缺少 OOC_API_KEY 时抛错", () => {
    process.env.OOC_PROVIDER = "openai";
    process.env.OOC_BASE_URL = "https://example.com/v1";
    process.env.OOC_MODEL = "gpt-test";

    expect(() => readLlmEnv()).toThrow("OOC_API_KEY");
  });

  it("缺少 OOC_MODEL 时抛错", () => {
    process.env.OOC_PROVIDER = "claude";
    process.env.OOC_API_KEY = "test-key";
    process.env.OOC_BASE_URL = "https://example.com/v1";

    expect(() => readLlmEnv()).toThrow("OOC_MODEL");
  });
});
