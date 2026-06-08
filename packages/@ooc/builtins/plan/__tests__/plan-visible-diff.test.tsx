/**
 * plan-visible-diff.test — 迁移自 window-diff-renderers/PlanWindowDiff.test.ts（线 C cleanup）。
 *
 * 覆盖 step-level diff（design § 4.4）：
 *   - smoke: default export 是函数
 *   - Case 1: add step → 含 added
 *   - Case 2: remove step → 含 removed
 *   - Case 3: status 变化（pending → done）→ 含 changed
 *   - Case 4: text 变化 → changed
 *   - Case 5: subPlanWindowId added → changed + sub plan link 字样
 *   - Case 6: 完全不变 → unchanged
 *   - Case 7: title / description 字段 diff
 */

import { describe, expect, it, test } from "bun:test";
import PlanDiff from "@ooc/builtins/plan/visible/diff";
import { containsText, countByStatus as findByStatus } from "@ooc/web/src/domains/sessions/components/window-diff-renderers/test-utils";

test("plan visible/diff default-exports a component", () => {
  expect(typeof PlanDiff).toBe("function");
});

describe("PlanWindowDiff", () => {
  it("Case 1: add step → added", () => {
    const tree = PlanDiff({
      previous: {
        type: "plan",
        title: "T",
        steps: [{ id: "s1", text: "a", status: "pending" }],
      },
      current: {
        type: "plan",
        title: "T",
        steps: [
          { id: "s1", text: "a", status: "pending" },
          { id: "s2", text: "b", status: "pending" },
        ],
      },
    });
    expect(findByStatus(tree, "added")).toBeGreaterThanOrEqual(1);
  });

  it("Case 2: remove step → removed", () => {
    const tree = PlanDiff({
      previous: {
        type: "plan",
        steps: [
          { id: "s1", text: "a" },
          { id: "s2", text: "b" },
        ],
      },
      current: {
        type: "plan",
        steps: [{ id: "s1", text: "a" }],
      },
    });
    expect(findByStatus(tree, "removed")).toBeGreaterThanOrEqual(1);
  });

  it("Case 3: status 变化 (pending → done) → changed", () => {
    const tree = PlanDiff({
      previous: {
        type: "plan",
        steps: [{ id: "s1", text: "task", status: "pending" }],
      },
      current: {
        type: "plan",
        steps: [{ id: "s1", text: "task", status: "done" }],
      },
    });
    expect(findByStatus(tree, "changed")).toBeGreaterThanOrEqual(1);
  });

  it("Case 4: text 变化 → changed", () => {
    const tree = PlanDiff({
      previous: { type: "plan", steps: [{ id: "s1", text: "old" }] },
      current: { type: "plan", steps: [{ id: "s1", text: "new" }] },
    });
    expect(findByStatus(tree, "changed")).toBeGreaterThanOrEqual(1);
  });

  it("Case 5: subPlanWindowId 新增 → 含 sub plan link 字样", () => {
    const tree = PlanDiff({
      previous: { type: "plan", steps: [{ id: "s1", text: "t" }] },
      current: {
        type: "plan",
        steps: [{ id: "s1", text: "t", subPlanWindowId: "w_sub_1" }],
      },
    });
    expect(containsText(tree, "sub plan link")).toBe(true);
  });

  it("Case 6: 完全不变 → unchanged", () => {
    const steps = [{ id: "s1", text: "t", status: "pending" }];
    const tree = PlanDiff({
      previous: { type: "plan", title: "T", steps },
      current: { type: "plan", title: "T", steps },
    });
    expect(findByStatus(tree, "unchanged")).toBeGreaterThanOrEqual(1);
  });

  it("Case 7: title changed → changed", () => {
    const tree = PlanDiff({
      previous: { type: "plan", title: "old", steps: [] },
      current: { type: "plan", title: "new", steps: [] },
    });
    expect(findByStatus(tree, "changed")).toBeGreaterThanOrEqual(1);
  });
});
