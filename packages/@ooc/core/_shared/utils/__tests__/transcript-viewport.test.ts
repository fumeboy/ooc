import { describe, expect, it } from "bun:test";

import {
  DEFAULT_TRANSCRIPT_VIEWPORT,
  applyTranscriptViewport,
  hasAnyTranscriptViewportField,
  mergeTranscriptViewport,
} from "../viewport";

describe("transcript-viewport: defaults", () => {
  it("DEFAULT_TRANSCRIPT_VIEWPORT is { tail: 20 }", () => {
    expect(DEFAULT_TRANSCRIPT_VIEWPORT).toEqual({ tail: 20 });
  });

  it("DEFAULT_TRANSCRIPT_VIEWPORT is frozen", () => {
    expect(Object.isFrozen(DEFAULT_TRANSCRIPT_VIEWPORT)).toBe(true);
  });
});

describe("transcript-viewport: mergeTranscriptViewport - tail mode", () => {
  it("sets tail and clears any prior range", () => {
    const cur = { rangeStart: 0, rangeEnd: 30 };
    const r = mergeTranscriptViewport(cur, { tail: 50 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.viewport).toEqual({ tail: 50 });
    }
  });

  it("tail must be positive integer", () => {
    expect(mergeTranscriptViewport({}, { tail: 0 }).ok).toBe(false);
    expect(mergeTranscriptViewport({}, { tail: -1 }).ok).toBe(false);
    expect(mergeTranscriptViewport({}, { tail: 1.5 }).ok).toBe(false);
    expect(mergeTranscriptViewport({}, { tail: "10" }).ok).toBe(false);
  });

  it("tail = 1 is valid", () => {
    const r = mergeTranscriptViewport({}, { tail: 1 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.viewport).toEqual({ tail: 1 });
  });
});

describe("transcript-viewport: mergeTranscriptViewport - range mode", () => {
  it("sets range and clears any prior tail", () => {
    const cur = { tail: 20 };
    const r = mergeTranscriptViewport(cur, { range_start: 5, range_end: 15 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.viewport).toEqual({ rangeStart: 5, rangeEnd: 15 });
    }
  });

  it("range_start = range_end is valid (empty visible window)", () => {
    const r = mergeTranscriptViewport({}, { range_start: 5, range_end: 5 });
    expect(r.ok).toBe(true);
  });

  it("range_start > range_end fails", () => {
    const r = mergeTranscriptViewport({}, { range_start: 10, range_end: 5 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("range_start");
  });

  it("only one of range_start / range_end fails", () => {
    expect(mergeTranscriptViewport({}, { range_start: 0 }).ok).toBe(false);
    expect(mergeTranscriptViewport({}, { range_end: 30 }).ok).toBe(false);
  });

  it("negative range fails", () => {
    expect(
      mergeTranscriptViewport({}, { range_start: -1, range_end: 5 }).ok,
    ).toBe(false);
    expect(
      mergeTranscriptViewport({}, { range_start: 0, range_end: -1 }).ok,
    ).toBe(false);
  });

  it("non-integer range fails", () => {
    expect(
      mergeTranscriptViewport({}, { range_start: 0.5, range_end: 5 }).ok,
    ).toBe(false);
  });
});

describe("transcript-viewport: mergeTranscriptViewport - mutual exclusion", () => {
  it("tail + range_start fails", () => {
    const r = mergeTranscriptViewport({}, { tail: 10, range_start: 0 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("互斥");
  });

  it("tail + range_end fails", () => {
    const r = mergeTranscriptViewport({}, { tail: 10, range_end: 5 });
    expect(r.ok).toBe(false);
  });

  it("tail + range_start + range_end fails", () => {
    const r = mergeTranscriptViewport(
      {},
      { tail: 10, range_start: 0, range_end: 5 },
    );
    expect(r.ok).toBe(false);
  });
});

describe("transcript-viewport: mergeTranscriptViewport - no-op", () => {
  it("empty args returns current viewport unchanged", () => {
    const cur = { tail: 30 };
    const r = mergeTranscriptViewport(cur, {});
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.viewport).toBe(cur);
  });
});

describe("transcript-viewport: mergeTranscriptViewport - immutability", () => {
  it("bad input does not mutate current", () => {
    const cur = { tail: 20 };
    const r = mergeTranscriptViewport(cur, { tail: -1 });
    expect(r.ok).toBe(false);
    expect(cur).toEqual({ tail: 20 });
  });
});

describe("transcript-viewport: hasAnyTranscriptViewportField", () => {
  it("detects tail / range_start / range_end", () => {
    expect(hasAnyTranscriptViewportField({})).toBe(false);
    expect(hasAnyTranscriptViewportField({ tail: 10 })).toBe(true);
    expect(hasAnyTranscriptViewportField({ range_start: 0 })).toBe(true);
    expect(hasAnyTranscriptViewportField({ range_end: 5 })).toBe(true);
    expect(hasAnyTranscriptViewportField({ msg: "hi" })).toBe(false);
  });
});

describe("transcript-viewport: applyTranscriptViewport - tail mode", () => {
  it("returns full messages when total <= tail", () => {
    const msgs = [1, 2, 3];
    const r = applyTranscriptViewport(msgs, { tail: 20 });
    expect(r.visible).toEqual([1, 2, 3]);
    expect(r.earlierCount).toBe(0);
  });

  it("slices to last N when total > tail", () => {
    const msgs = Array.from({ length: 30 }, (_, i) => i);
    const r = applyTranscriptViewport(msgs, { tail: 5 });
    expect(r.visible).toEqual([25, 26, 27, 28, 29]);
    expect(r.earlierCount).toBe(25);
  });

  it("tail = 1 returns single last item", () => {
    const r = applyTranscriptViewport([1, 2, 3], { tail: 1 });
    expect(r.visible).toEqual([3]);
    expect(r.earlierCount).toBe(2);
  });
});

describe("transcript-viewport: applyTranscriptViewport - range mode", () => {
  it("slices [rangeStart, rangeEnd)", () => {
    const msgs = Array.from({ length: 30 }, (_, i) => i);
    const r = applyTranscriptViewport(msgs, { rangeStart: 5, rangeEnd: 10 });
    expect(r.visible).toEqual([5, 6, 7, 8, 9]);
    expect(r.earlierCount).toBe(5);
  });

  it("rangeStart=0 means no earlier omitted", () => {
    const msgs = [10, 20, 30];
    const r = applyTranscriptViewport(msgs, { rangeStart: 0, rangeEnd: 2 });
    expect(r.visible).toEqual([10, 20]);
    expect(r.earlierCount).toBe(0);
  });

  it("range exceeding total clips to total", () => {
    const msgs = [1, 2, 3];
    const r = applyTranscriptViewport(msgs, { rangeStart: 0, rangeEnd: 100 });
    expect(r.visible).toEqual([1, 2, 3]);
    expect(r.earlierCount).toBe(0);
  });

  it("rangeStart=rangeEnd yields empty visible", () => {
    const msgs = [1, 2, 3];
    const r = applyTranscriptViewport(msgs, { rangeStart: 2, rangeEnd: 2 });
    expect(r.visible).toEqual([]);
    expect(r.earlierCount).toBe(2);
  });
});

describe("transcript-viewport: applyTranscriptViewport - empty input", () => {
  it("empty messages array returns empty visible + earlierCount=0", () => {
    const r = applyTranscriptViewport([], { tail: 20 });
    expect(r.visible).toEqual([]);
    expect(r.earlierCount).toBe(0);
  });

  it("empty messages array under range mode", () => {
    const r = applyTranscriptViewport([], { rangeStart: 0, rangeEnd: 10 });
    expect(r.visible).toEqual([]);
    expect(r.earlierCount).toBe(0);
  });
});
