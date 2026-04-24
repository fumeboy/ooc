/**
 * LLMInputViewer 解析辅助测试。
 *
 * 重点覆盖历史 llm.input.txt 的容错：曾经 latest 文件会被写成
 * `<system><system>...</system></system>`，viewer 不能用第一个 `</system>`
 * 截断，否则会制造 parse-error。
 */
import { describe, expect, test } from "bun:test";

import { splitMessageBlocks } from "../web/src/features/llm-input-parser.js";

describe("splitMessageBlocks", () => {
  test("同名 role 嵌套时按外层闭合标签切块", () => {
    const raw = [
      "<system>",
      "<system>",
      "  <identity>alice</identity>",
      "</system>",
      "</system>",
      "",
      "<user>",
      "<user>",
      "  <task>hello</task>",
      "</user>",
      "</user>",
    ].join("\n");

    const blocks = splitMessageBlocks(raw);

    expect(blocks).toHaveLength(2);
    expect(blocks[0]!.role).toBe("system");
    expect(blocks[0]!.rawXml).toBe([
      "<system>",
      "<system>",
      "  <identity>alice</identity>",
      "</system>",
      "</system>",
    ].join("\n"));
    expect(blocks[1]!.role).toBe("user");
    expect(blocks[1]!.rawXml).toContain("</user>\n</user>");
  });
});
