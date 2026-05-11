import { describe, expect, test } from "bun:test";
import { parseKnowledgeFile } from "../parser";

describe("parseKnowledgeFile", () => {
  test("parses frontmatter and body", () => {
    const text = `---
filename: file-ops
title: 文件操作
description: shell 读写文件
activates_on:
  show_description_when:
    - program
  show_content_when:
    - program.shell
---

# 正文标题

这是正文内容。`;
    const { frontmatter, body } = parseKnowledgeFile(text);
    expect(frontmatter.filename).toBe("file-ops");
    expect(frontmatter.title).toBe("文件操作");
    expect(frontmatter.description).toBe("shell 读写文件");
    expect(frontmatter.activates_on?.show_description_when).toEqual(["program"]);
    expect(frontmatter.activates_on?.show_content_when).toEqual(["program.shell"]);
    expect(body).toContain("# 正文标题");
    expect(body).toContain("这是正文内容。");
  });

  test("no frontmatter (text doesn't start with ---) → empty frontmatter, full body", () => {
    const text = `# 直接是正文\n\n没有 frontmatter。`;
    const { frontmatter, body } = parseKnowledgeFile(text);
    expect(frontmatter).toEqual({});
    expect(body).toBe(text);
  });

  test("frontmatter never closed → empty frontmatter, full body", () => {
    const text = `---
filename: bad
title: 没闭合

正文也没有 closing fence`;
    const { frontmatter, body } = parseKnowledgeFile(text);
    expect(frontmatter).toEqual({});
    expect(body).toBe(text);
  });

  test("yaml syntax error → empty frontmatter, body preserved", () => {
    const text = `---
filename: : :::invalid yaml
---

body text`;
    const { frontmatter, body } = parseKnowledgeFile(text);
    expect(frontmatter).toEqual({});
    expect(body).toContain("body text");
  });

  test("empty file", () => {
    const { frontmatter, body } = parseKnowledgeFile("");
    expect(frontmatter).toEqual({});
    expect(body).toBe("");
  });

  test("frontmatter with no body", () => {
    const text = `---
filename: only-fm
---
`;
    const { frontmatter, body } = parseKnowledgeFile(text);
    expect(frontmatter.filename).toBe("only-fm");
    expect(body).toBe("");
  });
});
