/**
 * method-exec-diff.test — 迁移自 window-diff-renderers/OtherRenderers.test.ts（线 C cleanup）。
 *
 * 覆盖：
 *   - smoke: default export 是函数
 *   - Case 1: args 新增 key → added
 *   - Case 2: args 改值 → changed
 *   - Case 3: status 变 → changed (Round 13 四态机: open → failed)
 */

import { describe, expect, it, test } from "bun:test";
import MethodExecDiff from "../MethodExecDiff";
import { countByStatus } from "../../window-diff-renderers/test-utils";

test("method_exec diff default-exports a component", () => {
  expect(typeof MethodExecDiff).toBe("function");
});

describe("CommandExecDiff", () => {
  it("Case 1: args 新增 key → added", () => {
    const tree = MethodExecDiff({
      previous: { type: "method_exec", command: "search", accumulatedArgs: { q: "x" } },
      current: { type: "method_exec", command: "search", accumulatedArgs: { q: "x", limit: 10 } },
    });
    expect(countByStatus(tree, "added")).toBeGreaterThanOrEqual(1);
  });

  it("Case 2: args 改值 → changed", () => {
    const tree = MethodExecDiff({
      previous: { type: "method_exec", command: "search", accumulatedArgs: { q: "x" } },
      current: { type: "method_exec", command: "search", accumulatedArgs: { q: "y" } },
    });
    expect(countByStatus(tree, "changed")).toBeGreaterThanOrEqual(1);
  });

  it("Case 3: status 变 → changed (Round 13 四态机: open → failed)", () => {
    const tree = MethodExecDiff({
      previous: { type: "method_exec", command: "search", status: "open" },
      current: { type: "method_exec", command: "search", status: "failed" },
    });
    expect(countByStatus(tree, "changed")).toBeGreaterThanOrEqual(1);
  });
});
