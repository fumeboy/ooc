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
    result: "viewport updated",
  }),
};

const failViewport: WindowMethod = {
  paths: ["set_bad"],
  intent: () => [],
  exec: () => ({ ok: false, error: "[file_window.set_bad] line_start > line_end" }),
};

function fileWindowFixture() {
  const registry = new ObjectRegistry();
  registry.registerReadable("file", {
    windowMethods: { set_viewport: setViewport, set_bad: failViewport },
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
        state: {},
      } as any,
    ],
  });
  // ensure a root window exists for parent resolution
  const mgr = WindowManager.fromThread(thread, registry);
  return { registry, thread, mgr };
}

test("windowMethod dispatch writes new state back to window", async () => {
  const { thread, mgr } = fileWindowFixture();
  const opened = await mgr.openMethodExec({
    thread,
    parentWindowId: "f1",
    method: "set_viewport",
    title: "set_viewport",
    args: { line_end: 123 },
  });
  expect(opened.autoSubmitted).toBe(true);
  expect(opened.submitResult).toBe("viewport updated");
  const w = mgr.get("f1") as any;
  expect(w.state.viewport.lineEnd).toBe(123);
});

test("windowMethod failure leaves window state untouched and form failed", async () => {
  const { thread, mgr } = fileWindowFixture();
  const before = mgr.get("f1") as any;
  expect(before.state.viewport).toBeUndefined();
  await mgr.openMethodExec({
    thread,
    parentWindowId: "f1",
    method: "set_bad",
    title: "set_bad",
    args: { x: 1 },
  });
  const after = mgr.get("f1") as any;
  expect(after.state.viewport).toBeUndefined();
  const failed = mgr
    .list()
    .find((x: any) => x.type === "method_exec" && x.method === "set_bad") as any;
  expect(failed?.status).toBe("failed");
  expect(String(failed?.result)).toContain("line_start");
});

test("windowMethod does not mutate object business data", async () => {
  const { thread, mgr } = fileWindowFixture();
  (mgr.get("f1") as any).path = "/etc/hostname";
  await mgr.openMethodExec({
    thread,
    parentWindowId: "f1",
    method: "set_viewport",
    title: "set_viewport",
    args: { line_end: 5 },
  });
  const w = mgr.get("f1") as any;
  expect(w.path).toBe("/etc/hostname");
  expect(w.state.viewport.lineEnd).toBe(5);
});
