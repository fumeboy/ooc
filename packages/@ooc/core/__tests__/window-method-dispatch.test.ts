import { test, expect } from "bun:test";
import { ObjectRegistry } from "../runtime/object-registry.js";
import { WindowManager } from "../executable/windows/_shared/manager.js";
import type { WindowMethod } from "../_shared/types/window-method.js";
import { makeThread } from "./make-thread.js";

const setViewport: WindowMethod = {
  description: "test method", intents: ["set_viewport"],
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
  description: "test method", intents: ["set_bad"],
  exec: () => ({ ok: false, error: "[file_window.set_bad] line_start > line_end" }),
};

function fileWindowFixture() {
  const registry = new ObjectRegistry();
  // 窗类型不再 seed 进 BASE_TYPE_DEFINITIONS——经 registerWindowClass 一处声明（seed-if-absent + windowMethods）。
  registry.registerWindowClass({
    type: "file",
    methods: {},
    windowMethods: { set_viewport: setViewport, set_bad: failViewport },
  });
  const thread = makeThread({
    id: "t",
    extraWindows: [
      {
        id: "f1",
        class: "file",
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
  expect(opened.directResult).toBe("viewport updated");
  const w = mgr.get("f1") as any;
  expect(w.state.viewport.lineEnd).toBe(123);
});

// 无 onFormChange 的 windowMethod 走直接执行路径：无 form 可留痕，失败直接 throw（fail-loud）。
test("windowMethod failure (direct path) throws and leaves window state untouched", async () => {
  const { thread, mgr } = fileWindowFixture();
  const before = mgr.get("f1") as any;
  expect(before.state.viewport).toBeUndefined();
  await expect(
    mgr.openMethodExec({
      thread,
      parentWindowId: "f1",
      method: "set_bad",
      title: "set_bad",
      args: { x: 1 },
    }),
  ).rejects.toThrow("line_start");
  const after = mgr.get("f1") as any;
  expect(after.state.viewport).toBeUndefined();
  const forms = mgr.list().filter((x: any) => x.class === "method_exec");
  expect(forms.length).toBe(0);
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
