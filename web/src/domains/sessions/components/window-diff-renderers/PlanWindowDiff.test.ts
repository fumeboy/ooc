/**
 * PlanWindowDiff.test — Round 10 F3.
 *
 * 覆盖 step-level diff（design § 4.4）：
 *   - Case 1: add step → 含 added
 *   - Case 2: remove step → 含 removed
 *   - Case 3: status 变化（pending → done）→ 含 changed
 *   - Case 4: text 变化 → changed
 *   - Case 5: subPlanWindowId added → changed + sub plan link 字样
 *   - Case 6: 完全不变 → unchanged
 *   - Case 7: title / description 字段 diff
 */

import { describe, expect, it } from "bun:test";
import { PlanWindowDiff } from "./PlanWindowDiff";
import { containsText, countByStatus as findByStatus } from "./test-utils";

describe("PlanWindowDiff", () => {
  it("Case 1: add step → added", () => {
    const tree = PlanWindowDiff({
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
      windowType: "plan",
      windowId: "w_plan_1",
    });
    expect(findByStatus(tree, "added")).toBeGreaterThanOrEqual(1);
  });

  it("Case 2: remove step → removed", () => {
    const tree = PlanWindowDiff({
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
      windowType: "plan",
      windowId: "w_plan_2",
    });
    expect(findByStatus(tree, "removed")).toBeGreaterThanOrEqual(1);
  });

  it("Case 3: status 变化 (pending → done) → changed", () => {
    const tree = PlanWindowDiff({
      previous: {
        type: "plan",
        steps: [{ id: "s1", text: "task", status: "pending" }],
      },
      current: {
        type: "plan",
        steps: [{ id: "s1", text: "task", status: "done" }],
      },
      windowType: "plan",
      windowId: "w_plan_3",
    });
    expect(findByStatus(tree, "changed")).toBeGreaterThanOrEqual(1);
  });

  it("Case 4: text 变化 → changed", () => {
    const tree = PlanWindowDiff({
      previous: { type: "plan", steps: [{ id: "s1", text: "old" }] },
      current: { type: "plan", steps: [{ id: "s1", text: "new" }] },
      windowType: "plan",
      windowId: "w_plan_4",
    });
    expect(findByStatus(tree, "changed")).toBeGreaterThanOrEqual(1);
  });

  it("Case 5: subPlanWindowId 新增 → 含 sub plan link 字样", () => {
    const tree = PlanWindowDiff({
      previous: { type: "plan", steps: [{ id: "s1", text: "t" }] },
      current: {
        type: "plan",
        steps: [{ id: "s1", text: "t", subPlanWindowId: "w_sub_1" }],
      },
      windowType: "plan",
      windowId: "w_plan_5",
    });
    expect(containsText(tree, "sub plan link")).toBe(true);
  });

  it("Case 6: 完全不变 → unchanged", () => {
    const steps = [{ id: "s1", text: "t", status: "pending" }];
    const tree = PlanWindowDiff({
      previous: { type: "plan", title: "T", steps },
      current: { type: "plan", title: "T", steps },
      windowType: "plan",
      windowId: "w_plan_6",
    });
    expect(findByStatus(tree, "unchanged")).toBeGreaterThanOrEqual(1);
  });

  it("Case 7: title changed → changed", () => {
    const tree = PlanWindowDiff({
      previous: { type: "plan", title: "old", steps: [] },
      current: { type: "plan", title: "new", steps: [] },
      windowType: "plan",
      windowId: "w_plan_7",
    });
    expect(findByStatus(tree, "changed")).toBeGreaterThanOrEqual(1);
  });
});
