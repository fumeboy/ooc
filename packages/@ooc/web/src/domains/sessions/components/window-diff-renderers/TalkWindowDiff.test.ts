/**
 * TalkWindowDiff.test — Round 10 F3.
 *
 * 覆盖 transcript-level diff（design § 4.2）：
 *   - Case 1: 新消息（current 多 1 → added）
 *   - Case 2: 删消息（previous 多 1 → removed）
 *   - Case 3: content 变化（同 id → changed + 标黄）
 *   - Case 4: 完全不变（unchanged）
 *   - Case 5: target / status 字段 diff
 *   - Case 6: previous undefined（added 状态）→ 不崩
 */

import { describe, expect, it } from "bun:test";
import { TalkWindowDiff } from "./TalkWindowDiff";
import { countByStatus as findByStatus } from "./test-utils";

describe("TalkWindowDiff", () => {
  it("Case 1: 新增 1 条消息 → 含 added", () => {
    const tree = TalkWindowDiff({
      previous: {
        type: "talk",
        target: "alice",
        status: "open",
        transcript: [{ id: "m1", from: "a", content: "hi" }],
      },
      current: {
        type: "talk",
        target: "alice",
        status: "open",
        transcript: [
          { id: "m1", from: "a", content: "hi" },
          { id: "m2", from: "b", content: "hello" },
        ],
      },
      windowType: "talk",
      windowId: "w_talk_1",
    });
    expect(findByStatus(tree, "added")).toBeGreaterThanOrEqual(1);
  });

  it("Case 2: 删 1 条消息 → 含 removed", () => {
    const tree = TalkWindowDiff({
      previous: {
        type: "talk",
        target: "alice",
        transcript: [
          { id: "m1", content: "hi" },
          { id: "m2", content: "bye" },
        ],
      },
      current: {
        type: "talk",
        target: "alice",
        transcript: [{ id: "m1", content: "hi" }],
      },
      windowType: "talk",
      windowId: "w_talk_2",
    });
    expect(findByStatus(tree, "removed")).toBeGreaterThanOrEqual(1);
  });

  it("Case 3: 同 id 但 content 变 → 含 changed", () => {
    const tree = TalkWindowDiff({
      previous: { type: "talk", transcript: [{ id: "m1", content: "old" }] },
      current: { type: "talk", transcript: [{ id: "m1", content: "new" }] },
      windowType: "talk",
      windowId: "w_talk_3",
    });
    expect(findByStatus(tree, "changed")).toBeGreaterThanOrEqual(1);
  });

  it("Case 4: 完全不变 → unchanged 占主", () => {
    const tree = TalkWindowDiff({
      previous: { type: "talk", target: "alice", transcript: [{ id: "m1", content: "hi" }] },
      current: { type: "talk", target: "alice", transcript: [{ id: "m1", content: "hi" }] },
      windowType: "talk",
      windowId: "w_talk_4",
    });
    expect(findByStatus(tree, "unchanged")).toBeGreaterThanOrEqual(1);
  });

  it("Case 5: target 字段 changed → 含 changed", () => {
    const tree = TalkWindowDiff({
      previous: { type: "talk", target: "alice" },
      current: { type: "talk", target: "bob" },
      windowType: "talk",
      windowId: "w_talk_5",
    });
    expect(findByStatus(tree, "changed")).toBeGreaterThanOrEqual(1);
  });

  it("Case 6: previous undefined → 不崩；含 added", () => {
    const tree = TalkWindowDiff({
      previous: undefined,
      current: { type: "talk", target: "alice", transcript: [{ id: "m1", content: "hi" }] },
      windowType: "talk",
      windowId: "w_talk_6",
    });
    expect(tree).toBeDefined();
    expect(findByStatus(tree, "added")).toBeGreaterThanOrEqual(1);
  });
});
