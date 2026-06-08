import { test, expect } from "bun:test";
import { windowSetViewport } from "../executable/windows/_shared/viewport.js";
import { windowSetTranscriptViewport } from "../executable/windows/_shared/transcript-viewport.js";

test("windowSetViewport returns new state, does not mutate input", () => {
  const windowState = { viewport: { lineStart: 0, lineEnd: 10, columnStart: 0, columnEnd: 80 } };
  const out = windowSetViewport({ args: { line_end: 200 }, windowState } as any, "file");
  expect(out.ok).toBe(true);
  if (out.ok) expect(out.state.viewport?.lineEnd).toBe(200);
  expect(windowState.viewport.lineEnd).toBe(10); // input untouched
});

test("windowSetViewport no field => unchanged state ok", () => {
  const windowState = { viewport: { lineStart: 0, lineEnd: 10, columnStart: 0, columnEnd: 80 } };
  const out = windowSetViewport({ args: {}, windowState } as any, "file");
  expect(out.ok).toBe(true);
  if (out.ok) expect(out.state.viewport?.lineEnd).toBe(10);
});

test("windowSetViewport fail-loud propagates error", () => {
  const windowState = {};
  const out = windowSetViewport({ args: { line_start: 100, line_end: 50 }, windowState } as any, "file");
  expect(out.ok).toBe(false);
  if (!out.ok) expect(out.error).toContain("line_start");
});

test("windowSetTranscriptViewport returns new state with transcriptViewport", () => {
  const windowState = { transcriptViewport: { tail: 20 } };
  const out = windowSetTranscriptViewport({ args: { tail: 5 }, windowState } as any, ["talk"]);
  expect(out.ok).toBe(true);
  if (out.ok) expect(out.state.transcriptViewport?.tail).toBe(5);
  expect(windowState.transcriptViewport.tail).toBe(20); // input untouched
});
