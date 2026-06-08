import { test, expect } from "bun:test";
import { ObjectRegistry } from "../runtime/object-registry.js";
import { WindowManager } from "../executable/windows/_shared/manager.js";
import type { WindowMethod } from "../_shared/types/window-method.js";
import { makeThread } from "./make-thread.js";

const setViewport: WindowMethod = {
  paths: ["set_viewport"],
  intent: () => [],
  exec: (ctx) => ({
    ok: true,
    state: {
      ...ctx.windowState,
      viewport: {
        lineStart: 0,
        lineEnd: Number(ctx.args.line_end ?? 0),
        columnStart: 0,
        columnEnd: 80,
      },
    },
  }),
};

function fixture(initialState: unknown) {
  const registry = new ObjectRegistry();
  registry.registerObjectType("file", {
    methods: {},
    windowMethods: { set_viewport: setViewport },
  });
  const thread = makeThread({
    id: "t",
    extraWindows: [
      {
        id: "f1",
        type: "file",
        parentWindowId: "root",
        title: "f",
        status: "open",
        createdAt: 0,
        state: initialState,
      } as any,
    ],
  });
  return { registry, thread, mgr: WindowManager.fromThread(thread, registry) };
}

test("window.state survives toData round-trip", () => {
  const { mgr } = fixture({ viewport: { lineStart: 0, lineEnd: 5, columnStart: 0, columnEnd: 80 } });
  const data = mgr.toData();
  const w = data.find((x: any) => x.id === "f1") as any;
  expect(w.state.viewport.lineEnd).toBe(5);
});

test("windowMethod-written state survives toData + re-fromThread", async () => {
  const { registry, thread, mgr } = fixture({});
  await mgr.openMethodExec({
    thread,
    parentWindowId: "f1",
    command: "set_viewport",
    title: "set_viewport",
    args: { line_end: 42 },
  });
  thread.contextWindows = mgr.toData();

  // re-hydrate a fresh manager from the serialized thread
  const mgr2 = WindowManager.fromThread(thread, registry);
  const w = mgr2.get("f1") as any;
  expect(w.state.viewport.lineEnd).toBe(42);
});
