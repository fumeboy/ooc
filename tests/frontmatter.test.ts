/**
 * Frontmatter 解析测试
 */

import { describe, test, expect } from "bun:test";
import { parseReadme, serializeReadme } from "../src/persistence/frontmatter.js";

describe("parseReadme", () => {
  test("解析完整的 readme.md", () => {
    const content = `---
whoAmI: 研究员，擅长信息检索
functions:
  - name: search
    description: 搜索信息
  - name: analyze
    description: 分析数据
---
你是一个专业的研究员，擅长信息检索和深度分析。
你善于从多个来源整合信息，形成有价值的见解。`;

    const result = parseReadme(content);

    expect(result.talkable.whoAmI).toBe("研究员，擅长信息检索");
    expect(result.talkable.functions).toHaveLength(2);
    expect(result.talkable.functions[0]!.name).toBe("search");
    expect(result.talkable.functions[1]!.description).toBe("分析数据");
    expect(result.thinkable.whoAmI).toContain("专业的研究员");
  });

  test("解析没有 frontmatter 的 readme.md", () => {
    const content = "你是一个简单的助手。";
    const result = parseReadme(content);

    expect(result.talkable.whoAmI).toBe("");
    expect(result.talkable.functions).toHaveLength(0);
    expect(result.thinkable.whoAmI).toBe("你是一个简单的助手。");
  });

  test("解析只有 frontmatter 的 readme.md", () => {
    const content = `---
whoAmI: 工具对象
---
`;
    const result = parseReadme(content);

    expect(result.talkable.whoAmI).toBe("工具对象");
    expect(result.thinkable.whoAmI).toBe("");
  });
});

describe("serializeReadme", () => {
  test("序列化完整信息", () => {
    const thinkable = { whoAmI: "你是一个研究员" };
    const talkable = {
      whoAmI: "研究员",
      functions: [{ name: "search", description: "搜索" }],
    };

    const output = serializeReadme(thinkable, talkable);

    expect(output).toContain("whoAmI: 研究员");
    expect(output).toContain("name: search");
    expect(output).toContain("你是一个研究员");
  });

  test("往返一致性（parse → serialize → parse）", () => {
    const original = `---
whoAmI: 测试对象
functions:
  - name: foo
    description: 测试方法
---
我是一个测试对象。
`;
    const parsed = parseReadme(original);
    const serialized = serializeReadme(parsed.thinkable, parsed.talkable);
    const reparsed = parseReadme(serialized);

    expect(reparsed.talkable.whoAmI).toBe(parsed.talkable.whoAmI);
    expect(reparsed.talkable.functions).toEqual(parsed.talkable.functions);
    expect(reparsed.thinkable.whoAmI).toBe(parsed.thinkable.whoAmI);
  });
});
