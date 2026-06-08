import { test, expect } from "bun:test";
import type { WindowDisplayState } from "../_shared/types/window-state.js";
import type { BaseContextWindow } from "../_shared/types/context-window.js";

test("WindowDisplayState holds display params only", () => {
  const state: WindowDisplayState = {
    viewport: { lineStart: 0, lineEnd: 100, columnStart: 0, columnEnd: 200 },
  };
  expect(state.viewport?.lineEnd).toBe(100);
});

test("WindowDisplayState carries independent lines/columns slicing", () => {
  const state: WindowDisplayState = {
    viewport: { lineStart: 0, lineEnd: 100, columnStart: 0, columnEnd: 200 },
    lines: [10, 20],
    columns: [0, 80],
  };
  expect(state.lines).toEqual([10, 20]);
  expect(state.columns).toEqual([0, 80]);
});

test("BaseContextWindow carries optional state", () => {
  const w = {
    id: "x",
    type: "file",
    title: "x",
    status: "open",
    createdAt: 0,
    state: { viewport: { lineStart: 0, lineEnd: 10, columnStart: 0, columnEnd: 80 } },
  } as BaseContextWindow;
  expect((w.state as WindowDisplayState).viewport?.lineEnd).toBe(10);
});
