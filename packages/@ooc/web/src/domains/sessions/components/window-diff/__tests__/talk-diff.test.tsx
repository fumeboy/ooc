/**
 * talk-diff.test — 迁移自 window-diff-renderers/TalkWindowDiff.test.ts（线 C cleanup）。
 *
 * 覆盖 transcript-level diff：
 *   - smoke: default export 是函数
 *   - Case 1: 新消息（current 多 1 → added）
 *   - Case 2: 删消息（previous 多 1 → removed）
 *   - Case 3: content 变化（同 id → changed + 标黄）
 *   - Case 4: 完全不变（unchanged）
 *   - Case 5: target / status 字段 diff
 *   - Case 6: previous undefined（added 状态）→ 不崩
 */

import { describe, expect, it, test } from "bun:test";
import TalkDiff from "../TalkDiff";
import { countByStatus as findByStatus } from "../../window-diff-renderers/test-utils";

test("talk diff default-exports a component", () => {
  expect(typeof TalkDiff).toBe("function");
});

describe("TalkWindowDiff", () => {
  it("Case 1: 新增 1 条消息 → 含 added", () => {
    const tree = TalkDiff({
      previous: {
        class: "talk",
        target: "alice",
        status: "open",
        transcript: [{ id: "m1", from: "a", content: "hi" }],
      },
      current: {
        class: "talk",
        target: "alice",
        status: "open",
        transcript: [
          { id: "m1", from: "a", content: "hi" },
          { id: "m2", from: "b", content: "hello" },
        ],
      },
    });
    expect(findByStatus(tree, "added")).toBeGreaterThanOrEqual(1);
  });

  it("Case 2: 删 1 条消息 → 含 removed", () => {
    const tree = TalkDiff({
      previous: {
        class: "talk",
        target: "alice",
        transcript: [
          { id: "m1", content: "hi" },
          { id: "m2", content: "bye" },
        ],
      },
      current: {
        class: "talk",
        target: "alice",
        transcript: [{ id: "m1", content: "hi" }],
      },
    });
    expect(findByStatus(tree, "removed")).toBeGreaterThanOrEqual(1);
  });

  it("Case 3: 同 id 但 content 变 → 含 changed", () => {
    const tree = TalkDiff({
      previous: { class: "talk", transcript: [{ id: "m1", content: "old" }] },
      current: { class: "talk", transcript: [{ id: "m1", content: "new" }] },
    });
    expect(findByStatus(tree, "changed")).toBeGreaterThanOrEqual(1);
  });

  it("Case 4: 完全不变 → unchanged 占主", () => {
    const tree = TalkDiff({
      previous: { class: "talk", target: "alice", transcript: [{ id: "m1", content: "hi" }] },
      current: { class: "talk", target: "alice", transcript: [{ id: "m1", content: "hi" }] },
    });
    expect(findByStatus(tree, "unchanged")).toBeGreaterThanOrEqual(1);
  });

  it("Case 5: target 字段 changed → 含 changed", () => {
    const tree = TalkDiff({
      previous: { class: "talk", target: "alice" },
      current: { class: "talk", target: "bob" },
    });
    expect(findByStatus(tree, "changed")).toBeGreaterThanOrEqual(1);
  });

  it("Case 6: previous undefined → 不崩；含 added", () => {
    const tree = TalkDiff({
      previous: undefined,
      current: { class: "talk", target: "alice", transcript: [{ id: "m1", content: "hi" }] },
    });
    expect(tree).toBeDefined();
    expect(findByStatus(tree, "added")).toBeGreaterThanOrEqual(1);
  });
});
