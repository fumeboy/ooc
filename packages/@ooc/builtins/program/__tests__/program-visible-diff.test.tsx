/**
 * program-visible-diff.test — 迁移自 window-diff-renderers/OtherRenderers.test.ts（线 C cleanup）。
 *
 * 覆盖：
 *   - smoke: default export 是函数
 *   - Case 1: 新增 exec → added
 *   - Case 2: 不变 → unchanged
 */

import { describe, expect, it, test } from "bun:test";
import ProgramDiff from "@ooc/builtins/program/visible/diff";
import { countByStatus } from "@ooc/web/src/domains/sessions/components/window-diff-renderers/test-utils";

test("program visible/diff default-exports a component", () => {
  expect(typeof ProgramDiff).toBe("function");
});

describe("ProgramWindowDiff", () => {
  it("Case 1: 新增 exec → added", () => {
    const tree = ProgramDiff({
      previous: { class: "program", history: [{ execId: "e1", code: "ls", output: "ok", ok: true }] },
      current: {
        class: "program",
        history: [
          { execId: "e1", code: "ls", output: "ok", ok: true },
          { execId: "e2", code: "pwd", output: "/x", ok: true },
        ],
      },
    });
    expect(countByStatus(tree, "added")).toBeGreaterThanOrEqual(1);
  });

  it("Case 2: 不变 → unchanged", () => {
    const h = [{ execId: "e1", code: "ls", output: "ok", ok: true }];
    const tree = ProgramDiff({
      previous: { class: "program", history: h },
      current: { class: "program", history: h },
    });
    expect(countByStatus(tree, "unchanged")).toBeGreaterThanOrEqual(1);
  });
});
