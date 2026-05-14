import { describe, expect, it } from "bun:test";
import { collectXmlTextContent, isLlmInputJsonPath } from "./LLMInputJsonViewer";

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

describe("collectXmlTextContent", () => {
  it("keeps CDATA text together with normal text nodes", () => {
    const text = collectXmlTextContent([
      { nodeType: 3, nodeValue: "before" },
      { nodeType: 4, nodeValue: "<knowledge><![CDATA[payload]]></knowledge>" },
      { nodeType: 3, nodeValue: "after" },
    ]);

    expect(text).toContain("before");
    expect(text).toContain("<knowledge><![CDATA[payload]]></knowledge>");
    expect(text).toContain("after");
  });
});
