/**
 * search-visible-diff.test — 迁移自 window-diff-renderers/OtherRenderers.test.ts（线 C cleanup）。
 *
 * 覆盖：
 *   - smoke: default export 是函数
 *   - Case 1: 新增 match → added
 *   - Case 2: 删除 match → removed
 *   - Case 3: snippet 变 → changed
 */

import { describe, expect, it, test } from "bun:test";
import SearchDiff from "@ooc/builtins/search/visible/diff";
import { countByStatus } from "@ooc/web/src/domains/sessions/components/window-diff-renderers/test-utils";

test("search visible/diff default-exports a component", () => {
  expect(typeof SearchDiff).toBe("function");
});

describe("SearchWindowDiff", () => {
  it("Case 1: 新增 match → added", () => {
    const tree = SearchDiff({
      previous: { type: "search", matches: [{ path: "a", line: 1 }] },
      current: {
        type: "search",
        matches: [
          { path: "a", line: 1 },
          { path: "b", line: 2 },
        ],
      },
    });
    expect(countByStatus(tree, "added")).toBeGreaterThanOrEqual(1);
  });

  it("Case 2: 删除 match → removed", () => {
    const tree = SearchDiff({
      previous: {
        type: "search",
        matches: [
          { path: "a", line: 1 },
          { path: "b", line: 2 },
        ],
      },
      current: { type: "search", matches: [{ path: "a", line: 1 }] },
    });
    expect(countByStatus(tree, "removed")).toBeGreaterThanOrEqual(1);
  });

  it("Case 3: snippet 变 → changed", () => {
    const tree = SearchDiff({
      previous: { type: "search", matches: [{ path: "a", line: 1, snippet: "old" }] },
      current: { type: "search", matches: [{ path: "a", line: 1, snippet: "new" }] },
    });
    expect(countByStatus(tree, "changed")).toBeGreaterThanOrEqual(1);
  });
});
