/**
 * knowledge-visible-diff.test — 迁移自 window-diff-renderers/OtherRenderers.test.ts（线 C cleanup）。
 *
 * 覆盖：
 *   - smoke: default export 是函数
 *   - Case 1: body 变 + frontmatter 字段 diff → 含 changed 字段
 *   - Case 2: added (previous undefined) → 不崩
 */

import { describe, expect, it, test } from "bun:test";
import KnowledgeDiff from "@ooc/builtins/knowledge_base/knowledge/visible/diff";
import { countByStatus } from "@ooc/web/src/domains/sessions/components/window-diff-renderers/test-utils";

test("knowledge visible/diff default-exports a component", () => {
  expect(typeof KnowledgeDiff).toBe("function");
});

describe("KnowledgeWindowDiff", () => {
  it("Case 1: body 变 + frontmatter 字段 diff → 含 changed 字段", () => {
    const tree = KnowledgeDiff({
      previous: {
        class: "knowledge",
        path: "k.md",
        body: "old body",
        frontmatter: { title: "A" },
      },
      current: {
        class: "knowledge",
        path: "k.md",
        body: "new body",
        frontmatter: { title: "B" },
      },
    });
    expect(countByStatus(tree, "changed")).toBeGreaterThanOrEqual(1);
  });

  it("Case 2: added (previous undefined) → 不崩", () => {
    const tree = KnowledgeDiff({
      previous: undefined,
      current: { class: "knowledge", path: "k.md", body: "x" },
    });
    expect(tree).toBeDefined();
    expect(countByStatus(tree, "added")).toBeGreaterThanOrEqual(1);
  });
});
