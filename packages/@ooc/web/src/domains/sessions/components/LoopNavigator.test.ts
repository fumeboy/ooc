/**
 * LoopNavigator tests.
 *
 * 不依赖 DOM；只对纯函数 planNavigate 做断言（与 LoopTimeline 测试同款无 RTL 风格）。
 * 覆盖 prev / next / latest 三个方向 + 边界 disabled 行为。
 */

import { describe, expect, it } from "bun:test";
import { planNavigate } from "./LoopNavigator";
import type { LoopListEntry } from "./loop-types";

function makeLoops(indices: number[]): LoopListEntry[] {
  return indices.map((i) => ({
    loopIndex: i,
    hasInput: true,
    hasOutput: true,
    hasMeta: true,
  }));
}

describe("planNavigate — Loop Navigator 边界", () => {
  it("空 loops → undefined（任何方向）", () => {
    expect(planNavigate([], 0, "prev")).toBeUndefined();
    expect(planNavigate([], 0, "next")).toBeUndefined();
    expect(planNavigate([], 0, "latest")).toBeUndefined();
  });

  it("3 个 loop / current=1 → prev=0 / next=2 / latest=2", () => {
    const loops = makeLoops([0, 1, 2]);
    expect(planNavigate(loops, 1, "prev")).toBe(0);
    expect(planNavigate(loops, 1, "next")).toBe(2);
    expect(planNavigate(loops, 1, "latest")).toBe(2);
  });

  it("current=0 → prev 边界 (undefined)", () => {
    const loops = makeLoops([0, 1, 2]);
    expect(planNavigate(loops, 0, "prev")).toBeUndefined();
    expect(planNavigate(loops, 0, "next")).toBe(1);
  });

  it("current=2 (最大) → next 边界 (undefined) + latest 等价不切 (undefined)", () => {
    const loops = makeLoops([0, 1, 2]);
    expect(planNavigate(loops, 2, "next")).toBeUndefined();
    expect(planNavigate(loops, 2, "latest")).toBeUndefined();
    expect(planNavigate(loops, 2, "prev")).toBe(1);
  });

  it("非连续 loopIndex (0, 3, 7) 仍按排序顺序跳", () => {
    const loops = makeLoops([0, 3, 7]);
    expect(planNavigate(loops, 3, "prev")).toBe(0);
    expect(planNavigate(loops, 3, "next")).toBe(7);
    expect(planNavigate(loops, 0, "prev")).toBeUndefined();
    expect(planNavigate(loops, 7, "next")).toBeUndefined();
  });

  it("current 不在 loops 列表中（防御）→ prev / next 仍找出最近邻", () => {
    const loops = makeLoops([0, 3, 7]);
    expect(planNavigate(loops, 5, "prev")).toBe(3);
    expect(planNavigate(loops, 5, "next")).toBe(7);
  });
});
