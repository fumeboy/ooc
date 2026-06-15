import { test, expect } from "bun:test";
import "@ooc/core/runtime/register-builtins.js"; // 全量 boot + assertAllObjectDefinitionsRegistered
import { builtinRegistry } from "@ooc/core/runtime/object-registry.js";

test("file set_viewport / set_range are windowMethods, not object methods", () => {
  const def = builtinRegistry.getObjectDefinition("file");
  expect(def.windowMethods?.set_viewport).toBeDefined();
  expect(def.windowMethods?.set_range).toBeDefined();
  expect(def.methods?.set_viewport).toBeUndefined();
  expect(def.methods?.set_range).toBeUndefined();
});

test("file business methods remain object methods", () => {
  const def = builtinRegistry.getObjectDefinition("file");
  expect(def.methods?.reload).toBeDefined();
  expect(def.methods?.edit).toBeDefined();
  expect(def.methods?.close).toBeDefined();
  expect(def.methods?.file).toBeDefined();
});

test("file readable reads viewport from window.state", async () => {
  const { readable } = await import("@ooc/builtins/filesystem/file/readable.js");
  const nodes = await readable({
    window: {
      class: "file",
      path: "/etc/hostname",
      state: { viewport: { lineStart: 0, lineEnd: 1, columnStart: 0, columnEnd: 80 } },
    },
    thread: {},
  } as any);
  const viewportNode = nodes.find((n: any) => n.tag === "viewport") as any;
  expect(viewportNode?.attrs?.line_end).toBe("1");
});

test("file readable back-compat reads legacy top-level viewport", async () => {
  const { readable } = await import("@ooc/builtins/filesystem/file/readable.js");
  const nodes = await readable({
    window: {
      class: "file",
      path: "/etc/hostname",
      viewport: { lineStart: 0, lineEnd: 7, columnStart: 0, columnEnd: 80 },
    },
    thread: {},
  } as any);
  const viewportNode = nodes.find((n: any) => n.tag === "viewport") as any;
  expect(viewportNode?.attrs?.line_end).toBe("7");
});
