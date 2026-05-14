import { describe, expect, it } from "bun:test";
import { isLlmInputJsonPath } from "./LLMInputJsonViewer";

describe("isLlmInputJsonPath", () => {
  it("matches llm.input.json", () => {
    expect(isLlmInputJsonPath("llm.input.json")).toBe(true);
    expect(isLlmInputJsonPath("/tmp/debug/llm.input.json")).toBe(true);
  });

  it("matches loop_<digits>.input.json", () => {
    expect(isLlmInputJsonPath("loop_0002.input.json")).toBe(true);
    expect(isLlmInputJsonPath("/tmp/debug/loop_0002.input.json")).toBe(true);
  });

  it("rejects other json files", () => {
    expect(isLlmInputJsonPath("loop_xxxx.input.json")).toBe(false);
    expect(isLlmInputJsonPath("loop_12.output.json")).toBe(false);
    expect(isLlmInputJsonPath("other.input.json")).toBe(false);
  });
});
