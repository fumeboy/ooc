import { describe, expect, it } from "bun:test";

import {
  DEFAULT_VIEWPORT,
  applyViewport,
  mergeViewport,
} from "../readable/viewport";

describe("viewport: defaults", () => {
  it("DEFAULT_VIEWPORT is 0-200 / 0-200", () => {
    expect(DEFAULT_VIEWPORT).toEqual({
      lineStart: 0,
      lineEnd: 200,
      columnStart: 0,
      columnEnd: 200,
    });
  });

  it("DEFAULT_VIEWPORT is frozen", () => {
    expect(Object.isFrozen(DEFAULT_VIEWPORT)).toBe(true);
  });
});

describe("viewport: mergeViewport - partial merge", () => {
  it("missing fields preserve current value", () => {
    const cur = { lineStart: 10, lineEnd: 50, columnStart: 5, columnEnd: 80 };
    const r = mergeViewport(cur, { line_end: 100 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.viewport).toEqual({
        lineStart: 10,
        lineEnd: 100,
        columnStart: 5,
        columnEnd: 80,
      });
    }
  });

  it("all four fields can be set at once", () => {
    const r = mergeViewport(DEFAULT_VIEWPORT, {
      line_start: 5,
      line_end: 50,
      column_start: 10,
      column_end: 120,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.viewport).toEqual({
        lineStart: 5,
        lineEnd: 50,
        columnStart: 10,
        columnEnd: 120,
      });
    }
  });

  it("empty args returns unchanged viewport", () => {
    const cur = { lineStart: 0, lineEnd: 200, columnStart: 0, columnEnd: 200 };
    const r = mergeViewport(cur, {});
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.viewport).toEqual(cur);
  });
});

describe("viewport: mergeViewport - fail-loud", () => {
  it("non-integer fails", () => {
    const r = mergeViewport(DEFAULT_VIEWPORT, { line_start: 1.5 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("line_start");
  });

  it("negative fails", () => {
    const r = mergeViewport(DEFAULT_VIEWPORT, { line_end: -1 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("line_end");
  });

  it("string fails", () => {
    const r = mergeViewport(DEFAULT_VIEWPORT, { column_start: "5" });
    expect(r.ok).toBe(false);
  });

  it("line_start > line_end fails", () => {
    const r = mergeViewport(DEFAULT_VIEWPORT, { line_start: 100, line_end: 50 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("line_start");
  });

  it("column_start > column_end fails", () => {
    const r = mergeViewport(DEFAULT_VIEWPORT, {
      column_start: 100,
      column_end: 50,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("column_start");
  });

  it("partial fail-loud: bad input does not mutate current", () => {
    const cur = { lineStart: 0, lineEnd: 200, columnStart: 0, columnEnd: 200 };
    const r = mergeViewport(cur, { line_end: -10 });
    expect(r.ok).toBe(false);
    // 原 cur 不应被改
    expect(cur.lineEnd).toBe(200);
  });
});

describe("viewport: applyViewport - line slicing", () => {
  it("default 0-200 returns full content for short file", () => {
    const text = "a\nb\nc";
    const out = applyViewport(text, DEFAULT_VIEWPORT);
    expect(out).toBe("a\nb\nc");
  });

  it("empty input returns empty", () => {
    expect(applyViewport("", DEFAULT_VIEWPORT)).toBe("");
  });

  it("truncates to lineEnd and appends overflow marker", () => {
    const lines = Array.from({ length: 250 }, (_, i) => `L${i}`).join("\n");
    const out = applyViewport(lines, {
      lineStart: 0,
      lineEnd: 200,
      columnStart: 0,
      columnEnd: 200,
    });
    expect(out).toContain("L0");
    expect(out).toContain("L199");
    expect(out).not.toContain("L200");
    expect(out).toContain("…(+50 more lines)");
  });

  it("respects lineStart > 0", () => {
    const lines = Array.from({ length: 50 }, (_, i) => `L${i}`).join("\n");
    const out = applyViewport(lines, {
      lineStart: 10,
      lineEnd: 20,
      columnStart: 0,
      columnEnd: 200,
    });
    const rendered = out.split("\n");
    expect(rendered[0]).toBe("L10");
    // last line is overflow marker; L19 is second-to-last
    expect(rendered[rendered.length - 1]).toBe("…(+30 more lines)");
    expect(rendered[rendered.length - 2]).toBe("L19");
  });

  it("lineStart = lineEnd returns empty body (no lines) + still mark overflow", () => {
    const lines = "a\nb\nc";
    const out = applyViewport(lines, {
      lineStart: 0,
      lineEnd: 0,
      columnStart: 0,
      columnEnd: 200,
    });
    // 切完空，但仍有 3 行总数 > 0 → overflow marker
    expect(out).toContain("…(+3 more lines)");
  });
});

describe("viewport: applyViewport - column slicing", () => {
  it("truncates long line with column marker", () => {
    const long = "x".repeat(300);
    const out = applyViewport(long, {
      lineStart: 0,
      lineEnd: 200,
      columnStart: 0,
      columnEnd: 200,
    });
    expect(out).toContain("…(+100 more)");
    // visible 是 200 个 x
    expect(out.replace("…(+100 more)", "")).toBe("x".repeat(200));
  });

  it("columnStart > 0 adds (+N before)…", () => {
    const text = "abcdef";
    const out = applyViewport(text, {
      lineStart: 0,
      lineEnd: 200,
      columnStart: 2,
      columnEnd: 4,
    });
    expect(out).toBe("(+2 before)…cd…(+2 more)");
  });

  it("整行长度 <= columnStart 返回空（per line）", () => {
    const text = "short\n" + "x".repeat(300);
    const out = applyViewport(text, {
      lineStart: 0,
      lineEnd: 200,
      columnStart: 100,
      columnEnd: 200,
    });
    const rendered = out.split("\n");
    expect(rendered[0]).toBe(""); // short 行整体被裁掉
    expect(rendered[1]).toContain("(+100 before)");
    expect(rendered[1]).toContain("…(+100 more)");
  });

  it("空行保持空", () => {
    const text = "a\n\nc";
    const out = applyViewport(text, DEFAULT_VIEWPORT);
    expect(out).toBe("a\n\nc");
  });
});

// sliceColumn 边界 case 由上方 applyViewport 列裁剪测试间接覆盖（sliceColumn 现为
// readable/viewport.ts 内部 helper，不导出）。
