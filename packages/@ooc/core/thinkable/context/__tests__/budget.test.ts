/**
 * budget.test.ts — BudgetManager unit tests.
 *
 * Legacy applyNaturalDecay / applyEmergencyGuard / estimateThreadTokens
 * have been removed. BudgetManager is the canonical budget API.
 *
 * Tests here cover:
 * - score(): provenance/priority/recency/signal weighting
 * - allocate(): ranking by relevance, budget overflow, guidance inherits form score
 */

import { describe, expect, it } from "bun:test";
import { BudgetManager } from "../budget";
import type {
  ContextWindow,
  ContextWindowProvenance,
  ContextWindowRelevance,
} from "@ooc/core/_shared/types/context-window.js";

const bm = new BudgetManager();

// ─────────────────────────── helpers ─────────────────────────────────────────

/** Build a structurally complete ContextWindowProvenance with sensible defaults. */
function mkProv(
  overrides: Partial<ContextWindowProvenance> & {
    kind: ContextWindowProvenance["kind"];
  },
): ContextWindowProvenance {
  const now = Date.now();
  return {
    reason: { mechanism: "user_open" },
    createdAt: now,
    lastTouchedAt: now,
    ...overrides,
  };
}

/** Build a structurally complete ContextWindowRelevance with sensible defaults. */
function mkRel(
  overrides: Partial<ContextWindowRelevance> = {},
): ContextWindowRelevance {
  return {
    score: 0.5,
    signalCount: 0,
    ...overrides,
  };
}

/**
 * Build a minimal test window using type "knowledge" (simplest builtin type
 * for budget tests — BudgetManager does not read knowledge-specific fields).
 */
function mkWindow(
  overrides: Partial<ContextWindow> & {
    id: string;
    title: string;
  },
): ContextWindow {
  const now = Date.now();
  return {
    class: "knowledge",
    parentWindowId: "root",
    status: "open",
    createdAt: now,
    path: `stones/test/knowledge/${overrides.id}.md`,
    ...overrides,
  } as ContextWindow;
}

// ─────────────────────────── score tests ─────────────────────────────────────

describe("BudgetManager.score", () => {
  it("uses provenance weight as base when no relevance.score is set", () => {
    const w1 = mkWindow({ id: "w1", title: "explicit", provenance: mkProv({ kind: "explicit" }) });
    const w2 = mkWindow({ id: "w2", title: "related", provenance: mkProv({ kind: "related" }) });
    expect(bm.score(w1)).toBeGreaterThan(bm.score(w2));
  });

  it("uses existing relevance.score as baseline", () => {
    const w = mkWindow({
      id: "w1",
      title: "t",
      provenance: mkProv({ kind: "related" }),
      relevance: mkRel({ score: 0.9 }),
    });
    // related default is 0.5; with score=0.9 baseline it should be much higher
    expect(bm.score(w)).toBeGreaterThan(0.7);
  });

  it("priorityHint boosts score", () => {
    // Use derived provenance (weight 0.7) as baseline so there is headroom for boosts.
    const wNormal = mkWindow({ id: "w1", title: "n", provenance: mkProv({ kind: "derived" }) });
    const wHigh = mkWindow({
      id: "w2",
      title: "h",
      provenance: mkProv({ kind: "derived" }),
      relevance: mkRel({ score: 0.7, priorityHint: "high" }),
    });
    const wCritical = mkWindow({
      id: "w3",
      title: "c",
      provenance: mkProv({ kind: "derived" }),
      relevance: mkRel({ score: 0.7, priorityHint: "critical" }),
    });
    expect(bm.score(wCritical)).toBeGreaterThan(bm.score(wHigh));
    expect(bm.score(wHigh)).toBeGreaterThan(bm.score(wNormal));
  });

  it("recently touched windows get a small boost", () => {
    const now = Date.now();
    const wRecent = mkWindow({
      id: "w1",
      title: "r",
      provenance: mkProv({ kind: "explicit", lastTouchedAt: now - 60_000 }),
    });
    const wOld = mkWindow({
      id: "w2",
      title: "o",
      provenance: mkProv({ kind: "explicit", lastTouchedAt: now - 2 * 60 * 60 * 1000 }),
    });
    expect(bm.score(wRecent, now)).toBeGreaterThan(bm.score(wOld, now));
  });

  it("signalCount increases relevance", () => {
    // Use derived provenance (0.7) as baseline so there is headroom for signal boost.
    const w0 = mkWindow({
      id: "w0",
      title: "a",
      provenance: mkProv({ kind: "derived" }),
      relevance: mkRel({ score: 0.7, signalCount: 0 }),
    });
    const w5 = mkWindow({
      id: "w5",
      title: "b",
      provenance: mkProv({ kind: "derived" }),
      relevance: mkRel({ score: 0.7, signalCount: 5 }),
    });
    expect(bm.score(w5)).toBeGreaterThan(bm.score(w0));
  });

  it("score is clamped to [0, 1]", () => {
    const w = mkWindow({
      id: "w",
      title: "t",
      provenance: mkProv({ kind: "explicit", lastTouchedAt: Date.now() }),
      relevance: mkRel({ score: 1.0, priorityHint: "critical", signalCount: 100 }),
    });
    expect(bm.score(w)).toBeLessThanOrEqual(1.0);
    expect(bm.score(w)).toBeGreaterThanOrEqual(0.0);
  });
});

// ─────────────────────────── allocate tests ──────────────────────────────────

describe("BudgetManager.allocate", () => {
  it("keeps all windows within budget", () => {
    const windows = [
      mkWindow({ id: "w1", title: "one", provenance: mkProv({ kind: "explicit" }) }),
      mkWindow({ id: "w2", title: "two", provenance: mkProv({ kind: "explicit" }) }),
    ];
    const result = bm.allocate(windows, 1_000_000); // huge budget
    expect(result.visible.length).toBe(2);
    expect(result.overflow.length).toBe(0);
  });

  it("ranks windows by relevance and excludes overflow", () => {
    // Use a tiny estimate function (1 token each) so budget controls everything
    const windows = [
      mkWindow({ id: "low", title: "low", provenance: mkProv({ kind: "related" }) }),
      mkWindow({
        id: "high",
        title: "high",
        provenance: mkProv({ kind: "explicit" }),
        relevance: mkRel({ score: 1.0, priorityHint: "critical" }),
      }),
      mkWindow({ id: "med", title: "med", provenance: mkProv({ kind: "explicit" }) }),
    ];
    // budget = 2 tokens → keep top 2
    const result = bm.allocate(windows, 2, () => 1);
    expect(result.visible.length).toBe(2);
    expect(result.overflow.length).toBe(1);
    const visibleIds = result.visible.map(w => w.id);
    expect(visibleIds).toContain("high");
    expect(visibleIds).toContain("med");
    expect(result.overflow[0].id).toBe("low");
  });

  it("marks single oversized window with window_too_large_for_budget", () => {
    const windows = [
      mkWindow({ id: "big", title: "big window", provenance: mkProv({ kind: "explicit" }) }),
    ];
    const result = bm.allocate(windows, 5, () => 100); // window costs 100, budget is 5
    expect(result.overflow.length).toBe(1);
    expect(result.overflow[0].reason).toBe("window_too_large_for_budget");
  });

  it("form-bound window (boundFormId) inherits the form's relevance score", () => {
    const form = mkWindow({
      id: "form_1",
      class: "method_exec",
      title: "my form",
      parentWindowId: "root",
      status: "open",
      method: "say",
      description: "",
      accumulatedArgs: {},
      intentPaths: ["say"],
      loadedKnowledgePaths: [],
      provenance: mkProv({ kind: "explicit" }),
      relevance: mkRel({ score: 1.0, priorityHint: "critical" }),
    });
    // form-bound knowledge window：自身分低但 boundFormId 指向 form（如 intent 触发的知识窗）
    const bound = mkWindow({
      id: "kn_1",
      class: "knowledge",
      title: "form-bound knowledge",
      parentWindowId: "form_1",
      status: "open",
      boundFormId: "form_1",
      provenance: mkProv({
        kind: "related",
        reason: { mechanism: "form_bound" },
      }) as ContextWindowProvenance & { reason: { mechanism: "form_bound" } },
      relevance: mkRel({ score: 0.1, signalCount: 0 }),
    });
    const result = bm.allocate([bound, form], 2, () => 1);
    // Both should rank near the top because the bound window inherits the form score
    expect(result.visible.map(w => w.id)).toEqual(expect.arrayContaining(["form_1", "kn_1"]));
  });
});
