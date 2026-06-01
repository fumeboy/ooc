/**
 * FallbackJsonDiff.test — Round 10 F3.
 *
 * 覆盖 design § 5：通用 JSON tree diff（字段级 added / removed / changed / unchanged）。
 *
 * - Case 1: 嵌套 object 字段变化
 * - Case 2: added (previous undefined)
 * - Case 3: removed (current undefined)
 * - Case 4: 数组按 index 配对（添加 entry / 删除 entry）
 * - Case 5: primitive 字段变化
 * - Case 6: 完全相同 → 全 unchanged
 */

import { describe, expect, it } from "bun:test";
import { FallbackJsonDiff } from "./FallbackJsonDiff";
import { countByStatus } from "./test-utils";

describe("FallbackJsonDiff", () => {
  it("Case 1: 嵌套 object 字段变化 → 含 changed", () => {
    const tree = FallbackJsonDiff({
      previous: { a: 1, b: { c: 2 } },
      current: { a: 1, b: { c: 3 } },
      windowType: "knowledge",
      windowId: "w_fb_1",
    });
    expect(countByStatus(tree, "changed")).toBeGreaterThanOrEqual(1);
    expect(countByStatus(tree, "unchanged")).toBeGreaterThanOrEqual(1);
  });

  it("Case 2: added (previous undefined)", () => {
    const tree = FallbackJsonDiff({
      previous: undefined,
      current: { a: 1, b: 2 },
      windowType: "knowledge",
      windowId: "w_fb_2",
    });
    expect(countByStatus(tree, "added")).toBeGreaterThanOrEqual(1);
    expect(countByStatus(tree, "removed")).toBe(0);
  });

  it("Case 3: removed (current undefined)", () => {
    const tree = FallbackJsonDiff({
      previous: { a: 1 },
      current: undefined,
      windowType: "knowledge",
      windowId: "w_fb_3",
    });
    expect(countByStatus(tree, "removed")).toBeGreaterThanOrEqual(1);
  });

  it("Case 4: 数组 entry 增加 → 该 entry 标 added", () => {
    const tree = FallbackJsonDiff({
      previous: { arr: [1, 2] },
      current: { arr: [1, 2, 3] },
      windowType: "knowledge",
      windowId: "w_fb_4",
    });
    expect(countByStatus(tree, "added")).toBeGreaterThanOrEqual(1);
  });

  it("Case 5: primitive 字段变化 → changed", () => {
    const tree = FallbackJsonDiff({
      previous: { name: "alice" },
      current: { name: "bob" },
      windowType: "knowledge",
      windowId: "w_fb_5",
    });
    expect(countByStatus(tree, "changed")).toBeGreaterThanOrEqual(1);
  });

  it("Case 6: 完全相同 → 全 unchanged", () => {
    const tree = FallbackJsonDiff({
      previous: { a: 1, b: "x" },
      current: { a: 1, b: "x" },
      windowType: "knowledge",
      windowId: "w_fb_6",
    });
    expect(countByStatus(tree, "changed")).toBe(0);
    expect(countByStatus(tree, "added")).toBe(0);
    expect(countByStatus(tree, "removed")).toBe(0);
    expect(countByStatus(tree, "unchanged")).toBeGreaterThanOrEqual(1);
  });

  it("Case 7: 不崩 — 各种 null / 空 input", () => {
    expect(() =>
      FallbackJsonDiff({
        previous: null,
        current: null,
        windowType: "knowledge",
        windowId: "w_fb_7",
      }),
    ).not.toThrow();
  });
});
