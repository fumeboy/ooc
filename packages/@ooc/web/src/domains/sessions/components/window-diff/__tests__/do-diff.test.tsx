/**
 * do-diff.test — 迁移自 window-diff-renderers/OtherRenderers.test.ts（线 C cleanup）。
 *
 * 覆盖：
 *   - smoke: default export 是函数
 *   - Case 1: status 变化 (running → archived) → changed
 *   - Case 2: previous undefined → added
 *   - Case 3: 不变 → unchanged
 */

import { describe, expect, it, test } from "bun:test";
import DoDiff from "../DoDiff";
import { countByStatus } from "../../window-diff-renderers/test-utils";

test("do diff default-exports a component", () => {
  expect(typeof DoDiff).toBe("function");
});

describe("DoWindowDiff", () => {
  it("Case 1: status 变化 (running → archived) → changed", () => {
    const tree = DoDiff({
      previous: { class: "do", status: "running", targetThreadId: "t1" },
      current: { class: "do", status: "archived", targetThreadId: "t1" },
    });
    expect(countByStatus(tree, "changed")).toBeGreaterThanOrEqual(1);
  });

  it("Case 2: previous undefined → added", () => {
    const tree = DoDiff({
      previous: undefined,
      current: { class: "do", status: "running" },
    });
    expect(countByStatus(tree, "added")).toBeGreaterThanOrEqual(1);
  });

  it("Case 3: 不变 → unchanged", () => {
    const tree = DoDiff({
      previous: { class: "do", status: "running", targetThreadId: "t1" },
      current: { class: "do", status: "running", targetThreadId: "t1" },
    });
    expect(countByStatus(tree, "unchanged")).toBeGreaterThanOrEqual(1);
  });
});
