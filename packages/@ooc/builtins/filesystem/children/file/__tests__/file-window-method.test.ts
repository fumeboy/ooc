import { test, expect } from "bun:test";
import { writeFile, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import "@ooc/core/runtime/register-builtins.js"; // 全量 boot：注册 file class
import { builtinRegistry } from "@ooc/core/runtime/object-registry.js";
import fileReadable from "@ooc/builtins/filesystem/file/readable/index.js";
import type { Data as FileData } from "@ooc/builtins/filesystem/file/types.js";
import type { FileWin } from "@ooc/builtins/filesystem/file/readable/index.js";

function objMethod(name: string) {
  return builtinRegistry.getClass("filesystem/file")?.executable?.methods.find((m) => m.name === name);
}
function windowMethod(name: string) {
  return builtinRegistry.resolveWindowMethod("filesystem/file", name);
}

test("file set_viewport / set_range 是 window method，不是 object method（维度隔离）", () => {
  // window method：动投影态 win，注册在 readable.window[].window_methods 上。
  expect(windowMethod("set_viewport")).toBeDefined();
  expect(windowMethod("set_range")).toBeDefined();
  // object method 表里不混入投影态方法。
  expect(objMethod("set_viewport")).toBeUndefined();
  expect(objMethod("set_range")).toBeUndefined();
});

test("file business methods 仍是 object method（reload/edit/close）；construct 是独立槽位非 method", () => {
  expect(objMethod("reload")).toBeDefined();
  expect(objMethod("edit")).toBeDefined();
  expect(objMethod("close")).toBeDefined();
  // 旧「constructor 当名为 file 的 method」已退役：construct 升为 OocClass.construct 独立槽位。
  expect(objMethod("file")).toBeUndefined();
  expect(builtinRegistry.resolveConstructor("filesystem/file")).toBeDefined();
});

test("file readable 从投影态 win.viewport 读 viewport 渲染 <viewport line_end>", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "ooc-file-win-"));
  try {
    const path = join(tmp, "hostname.txt");
    await writeFile(path, "alpha\nbravo\ncharlie\n", "utf8");
    const self: FileData = { path };
    const win: FileWin = { viewport: { lineStart: 0, lineEnd: 1, columnStart: 0, columnEnd: 80 } };
    const proj = await fileReadable.readable({} as never, self, win);
    const viewportNode = (proj.content as any[]).find((n: any) => n.tag === "viewport");
    expect(viewportNode?.attrs?.line_end).toBe("1");
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test("file readable 缺投影态走 DEFAULT_VIEWPORT 兜底（不崩，class=file）", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "ooc-file-win-"));
  try {
    const path = join(tmp, "hostname.txt");
    await writeFile(path, "x\ny\nz\n", "utf8");
    const self: FileData = { path };
    const proj = await fileReadable.readable({} as never, self, {} as FileWin);
    expect(proj.class).toBe("file");
    const viewportNode = (proj.content as any[]).find((n: any) => n.tag === "viewport");
    expect(viewportNode).toBeDefined();
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test("file set_viewport window method 返回新 win（不可变，写 win.viewport）", () => {
  const wm = windowMethod("set_viewport")!;
  const before: FileWin = { viewport: { lineStart: 0, lineEnd: 100, columnStart: 0, columnEnd: 200 } };
  const after = wm.exec({} as never, { path: "/x" }, before, { line_start: 5, line_end: 9 }) as FileWin;
  expect(after).not.toBe(before);
  expect(after.viewport.lineStart).toBe(5);
  expect(after.viewport.lineEnd).toBe(9);
  // before 未被原地改。
  expect(before.viewport.lineStart).toBe(0);
});
