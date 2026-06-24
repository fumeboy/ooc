/**
 * budget.test.ts — BudgetManager unit tests.
 *
 * 预算是 context 唯一的自动裁剪闸门。BudgetManager.allocate **按入参顺序**在 token 预算内
 * 裁剪——不做相关性排序（provenance/relevance 评分已退役：它们从无真实写入、评分恒取默认值）。
 * 超预算的窗归入 overflow（不丢，由 renderer 的 <context_overflow> 呈现）。
 */

import { describe, expect, it } from "bun:test";
import {
  BudgetManager,
  estimateWindowTokens,
  estimateWindowsTokens,
} from "../budget";
import type { ContextWindow } from "@ooc/core/types/context-window.js";

const bm = new BudgetManager();

/** 最小测试窗（OocObjectRef 实例；allocate 只读 id/title，estimate 读整窗）。 */
function mkWindow(over: { id: string; title: string }): ContextWindow {
  return {
    id: over.id,
    class: "_builtin/knowledge_base/knowledge",
    parentWindowId: "root",
    title: over.title,
    status: "open",
    createdAt: Date.now(),
  };
}

describe("BudgetManager.allocate", () => {
  it("keeps all windows within a huge budget", () => {
    const windows = [mkWindow({ id: "w1", title: "one" }), mkWindow({ id: "w2", title: "two" })];
    const result = bm.allocate(windows, 1_000_000);
    expect(result.visible.length).toBe(2);
    expect(result.overflow.length).toBe(0);
  });

  it("keeps windows in input order until budget is hit; the rest overflow", () => {
    const windows = [
      mkWindow({ id: "a", title: "a" }),
      mkWindow({ id: "b", title: "b" }),
      mkWindow({ id: "c", title: "c" }),
    ];
    // budget = 2 tokens, each window costs 1 → first two kept, third overflows
    const result = bm.allocate(windows, 2, () => 1);
    expect(result.visible.map((w) => w.id)).toEqual(["a", "b"]);
    expect(result.overflow.length).toBe(1);
    expect(result.overflow[0].id).toBe("c");
    expect(result.overflow[0].reason).toBe("budget_overflow");
  });

  it("marks a single oversized window with window_too_large_for_budget", () => {
    const windows = [mkWindow({ id: "big", title: "big window" })];
    const result = bm.allocate(windows, 5, () => 100); // window costs 100, budget 5
    expect(result.overflow.length).toBe(1);
    expect(result.overflow[0].reason).toBe("window_too_large_for_budget");
  });
});

describe("estimateWindowTokens", () => {
  it("estimates by JSON length / 4 (heuristic)", () => {
    const w = mkWindow({ id: "w", title: "t" });
    expect(estimateWindowTokens(w)).toBe(Math.ceil(JSON.stringify(w).length / 4));
  });

  it("sums a list of windows", () => {
    const ws = [mkWindow({ id: "a", title: "a" }), mkWindow({ id: "b", title: "b" })];
    expect(estimateWindowsTokens(ws)).toBe(estimateWindowTokens(ws[0]!) + estimateWindowTokens(ws[1]!));
  });
});
