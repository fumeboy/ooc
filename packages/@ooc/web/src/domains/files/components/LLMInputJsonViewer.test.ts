import { describe, expect, it } from "bun:test";
import { isLlmInputJsonPath, extractSystemPrompt } from "./LLMInputJsonViewer";

describe("extractSystemPrompt", () => {
  it("returns content of the first item when it is a system message", () => {
    const record = {
      inputItems: [
        { type: "message", role: "system", content: "<context>FIRST</context>" },
        { type: "message", role: "system", content: "<context>SECOND</context>" },
        { type: "message", role: "user", content: "hi" },
      ],
    };
    expect(extractSystemPrompt(record)).toBe("<context>FIRST</context>");
  });

  it("falls back to the first system message when index 0 is not system", () => {
    const record = {
      inputItems: [
        { type: "message", role: "assistant", content: "thinking" },
        { type: "message", role: "system", content: "<context>SYS</context>" },
      ],
    };
    expect(extractSystemPrompt(record)).toBe("<context>SYS</context>");
  });

  it("returns undefined when there is no system message", () => {
    const record = {
      inputItems: [
        { type: "message", role: "user", content: "hi" },
        { type: "function_call", name: "x", arguments: {} },
      ],
    };
    expect(extractSystemPrompt(record as never)).toBeUndefined();
  });

  it("returns undefined for empty / malformed records", () => {
    expect(extractSystemPrompt(null)).toBeUndefined();
    expect(extractSystemPrompt({})).toBeUndefined();
    expect(extractSystemPrompt({ inputItems: [] })).toBeUndefined();
  });

  it("ignores a system item whose content is not a string", () => {
    const record = {
      inputItems: [
        { type: "message", role: "system" },
        { type: "message", role: "system", content: "<context>OK</context>" },
      ],
    };
    expect(extractSystemPrompt(record as never)).toBe("<context>OK</context>");
  });
});

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
