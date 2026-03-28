/**
 * parseNavigateBlocks 单元测试
 */
import { describe, test, expect } from "bun:test";
import { parseNavigateBlocks } from "../web/src/lib/navigate-parser";

describe("parseNavigateBlocks", () => {
  test("extracts single navigate block with title and description", () => {
    const input = `请查看：\n[navigate title="项目看板" description="当前进度"]ooc://file/objects/supervisor/files/kanban.md[/navigate]`;
    const result = parseNavigateBlocks(input);
    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0]!.title).toBe("项目看板");
    expect(result.blocks[0]!.description).toBe("当前进度");
    expect(result.blocks[0]!.url).toBe("ooc://file/objects/supervisor/files/kanban.md");
    expect(result.cleanText).toContain("<!--ooc-nav-0-->");
    expect(result.cleanText).not.toContain("[navigate");
  });

  test("extracts navigate block with title only (no description)", () => {
    const input = `[navigate title="报告"]ooc://object/sophia[/navigate]`;
    const result = parseNavigateBlocks(input);
    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0]!.title).toBe("报告");
    expect(result.blocks[0]!.description).toBeUndefined();
    expect(result.blocks[0]!.url).toBe("ooc://object/sophia");
  });

  test("extracts multiple navigate blocks", () => {
    const input = `看这两个：\n[navigate title="A"]ooc://object/a[/navigate]\n中间文字\n[navigate title="B" description="desc"]ooc://object/b[/navigate]`;
    const result = parseNavigateBlocks(input);
    expect(result.blocks).toHaveLength(2);
    expect(result.blocks[0]!.title).toBe("A");
    expect(result.blocks[1]!.title).toBe("B");
    expect(result.cleanText).toContain("<!--ooc-nav-0-->");
    expect(result.cleanText).toContain("<!--ooc-nav-1-->");
    expect(result.cleanText).toContain("中间文字");
  });

  test("returns empty blocks for text without navigate markers", () => {
    const input = "普通文本，没有导航卡片";
    const result = parseNavigateBlocks(input);
    expect(result.blocks).toHaveLength(0);
    expect(result.cleanText).toBe(input);
  });

  test("handles non-ooc URL gracefully (still extracts)", () => {
    const input = `[navigate title="外部"]https://example.com[/navigate]`;
    const result = parseNavigateBlocks(input);
    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0]!.url).toBe("https://example.com");
  });

  test("does not match across line breaks in URL", () => {
    const input = `[navigate title="坏的"]ooc://object/\nbroken[/navigate]`;
    const result = parseNavigateBlocks(input);
    // \S+ won't match newline, so this should not match
    expect(result.blocks).toHaveLength(0);
  });
});
