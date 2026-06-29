/**
 * window-diff.helpers.test.
 *
 * 覆盖 4 态 diff 全分支 + 边界（current/previous undefined / 空数组）+ 顺序稳定性。
 * 与 LoopTimeline.test.ts / LoopTimeline.interactions.test.ts 同 bun:test 风格。
 */

import { describe, expect, it } from "bun:test";
import {
  computeWindowDiff,
  describeDiffStatus,
  type WindowSnapshotEntry,
} from "./window-diff.helpers";

function ws(
  id: string,
  type: string,
  contentHash: string,
  extra?: Partial<WindowSnapshotEntry>,
): WindowSnapshotEntry {
  return { id, class: type, contentHash, ...extra };
}

describe("computeWindowDiff — 4 态分支", () => {
  it("Case 1: current=[], previous=[] → 空数组（两边都空）", () => {
    expect(computeWindowDiff([], [])).toEqual([]);
  });

  it("Case 2: current 有 entry、prev 没 entry → 全 added", () => {
    const result = computeWindowDiff(
      [ws("w_1", "talk", "h1"), ws("w_2", "plan", "h2")],
      [],
    );
    expect(result.length).toBe(2);
    expect(result.every((r) => r.status === "added")).toBe(true);
    expect(result[0].previous).toBeUndefined();
    expect(result[0].current).toBeDefined();
  });

  it("Case 3: prev 有 entry、current 没 → 标记 removed (追加在末尾)", () => {
    const result = computeWindowDiff(
      [ws("w_1", "talk", "h1")],
      [ws("w_1", "talk", "h1"), ws("w_old", "search", "h_old")],
    );
    expect(result.length).toBe(2);
    expect(result[0].status).toBe("unchanged");
    expect(result[1].status).toBe("removed");
    expect(result[1].id).toBe("w_old");
    expect(result[1].current).toBeUndefined();
    expect(result[1].previous).toBeDefined();
  });

  it("Case 4: 同 id 同 hash → unchanged", () => {
    const result = computeWindowDiff(
      [ws("w_1", "talk", "h1")],
      [ws("w_1", "talk", "h1")],
    );
    expect(result.length).toBe(1);
    expect(result[0].status).toBe("unchanged");
  });

  it("Case 5: 同 id 不同 hash → changed", () => {
    const result = computeWindowDiff(
      [ws("w_1", "talk", "h2")],
      [ws("w_1", "talk", "h1")],
    );
    expect(result.length).toBe(1);
    expect(result[0].status).toBe("changed");
    expect(result[0].current?.contentHash).toBe("h2");
    expect(result[0].previous?.contentHash).toBe("h1");
  });

  it("Case 6: previous undefined（loop 0 / 老 loop 没 snapshot）→ 全 added", () => {
    const result = computeWindowDiff(
      [ws("w_1", "talk", "h1"), ws("w_2", "plan", "h2")],
      undefined,
    );
    expect(result.length).toBe(2);
    expect(result.every((r) => r.status === "added")).toBe(true);
  });

  it("current undefined（loop 没 snapshot 字段）→ 空数组（不能 diff）", () => {
    expect(computeWindowDiff(undefined, [ws("w_1", "talk", "h1")])).toEqual([]);
    expect(computeWindowDiff(undefined, undefined)).toEqual([]);
  });

  it("混合: added + changed + unchanged + removed 各 1 → 顺序稳定 (current 顺序 + removed 末尾)", () => {
    const previous = [
      ws("w_keep", "plan", "hk"),
      ws("w_change", "talk", "h_old"),
      ws("w_remove", "search", "hr"),
    ];
    const current = [
      ws("w_keep", "plan", "hk"), // unchanged
      ws("w_change", "talk", "h_new"), // changed
      ws("w_new", "do", "h_new"), // added
    ];
    const result = computeWindowDiff(current, previous);
    // Current 顺序 + removed 末尾
    expect(result.map((r) => r.id)).toEqual([
      "w_keep",
      "w_change",
      "w_new",
      "w_remove",
    ]);
    expect(result.map((r) => r.status)).toEqual([
      "unchanged",
      "changed",
      "added",
      "removed",
    ]);
  });

  it("过滤无 id 的脏数据，不应 throw", () => {
    const cur = [
      ws("w_1", "talk", "h1"),
      { type: "broken", contentHash: "x" } as unknown as WindowSnapshotEntry,
    ];
    const result = computeWindowDiff(cur, []);
    expect(result.length).toBe(1);
    expect(result[0].id).toBe("w_1");
  });
});

describe("describeDiffStatus — 视觉 token 映射", () => {
  it("4 态都返回非空 icon + label + className", () => {
    for (const s of ["added", "changed", "removed", "unchanged"] as const) {
      const d = describeDiffStatus(s);
      expect(d.icon.length).toBeGreaterThan(0);
      expect(d.label).toBe(s);
      expect(d.className).toBe(s);
    }
  });
});
