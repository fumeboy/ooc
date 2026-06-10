import { test, expect } from "bun:test";
import type { WindowMethod, WindowMethodOutcome } from "../_shared/types/window-method.js";

test("WindowMethod exec receives windowState and returns new state", async () => {
  const m: WindowMethod = {
    description: "test method", intents: ["set_viewport"],
    exec: (ctx) => ({
      ok: true,
      state: {
        ...ctx.windowState,
        viewport: { lineStart: 0, lineEnd: 50, columnStart: 0, columnEnd: 80 },
      },
    }),
  };
  const out = (await m.exec({ args: {}, windowState: {} })) as Extract<
    WindowMethodOutcome,
    { ok: true }
  >;
  expect(out.ok).toBe(true);
  expect(out.state.viewport?.lineEnd).toBe(50);
});

test("WindowMethod failure outcome carries error string", async () => {
  const m: WindowMethod = {
    description: "test method", intents: ["set_viewport"],
    exec: () => ({ ok: false, error: "bad input" }),
  };
  const out = await m.exec({ args: {}, windowState: {} });
  expect(out.ok).toBe(false);
  if (!out.ok) expect(out.error).toBe("bad input");
});
