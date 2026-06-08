/**
 * relation-diff.test — 迁移自 window-diff-renderers/OtherRenderers.test.ts（线 C cleanup）。
 *
 * 覆盖：
 *   - smoke: default export 是函数
 *   - Case 1: peerId / status 字段变化 → 含 changed
 *   - Case 2: 不崩 (空 body)
 */

import { describe, expect, it, test } from "bun:test";
import RelationDiff from "../RelationDiff";
import { countByStatus } from "../../window-diff-renderers/test-utils";

test("relation diff default-exports a component", () => {
  expect(typeof RelationDiff).toBe("function");
});

describe("RelationWindowDiff", () => {
  it("Case 1: peerId / status 字段变化 → 含 changed", () => {
    // 注：selfLongTermBody 的 diff 由 MarkdownBodyDiff (CodeMirror Merge) 渲染，
    // 走 hooks，需要 DOM env；本测试聚焦顶层字段 diff（peerId / status），
    // body diff 留给 vite build smoke + 体验官真实验证。
    const tree = RelationDiff({
      previous: { type: "relation", peerId: "alice", status: "open" },
      current: { type: "relation", peerId: "bob", status: "closed" },
    });
    expect(countByStatus(tree, "changed")).toBeGreaterThanOrEqual(1);
  });

  it("Case 2: 不崩 (空 body)", () => {
    expect(() =>
      RelationDiff({
        previous: { type: "relation", peerId: "alice" },
        current: { type: "relation", peerId: "alice" },
      }),
    ).not.toThrow();
  });
});
