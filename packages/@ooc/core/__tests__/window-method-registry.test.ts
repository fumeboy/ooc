import { test, expect } from "bun:test";
import { ObjectRegistry } from "../runtime/object-registry.js";
import type { WindowMethod } from "../_shared/types/window-method.js";

const wm: WindowMethod = {
  paths: ["set_viewport"],
  intent: () => [],
  exec: (ctx) => ({ ok: true, state: ctx.windowState }),
};

test("registerReadable keeps windowMethods on base type", () => {
  const r = new ObjectRegistry();
  r.registerReadable("file", { windowMethods: { set_viewport: wm } });
  expect(r.getObjectDefinition("file")?.windowMethods?.set_viewport).toBeDefined();
});

test("registerNewObjectType carries windowMethods", () => {
  const r = new ObjectRegistry();
  r.registerNewObjectType("my_doc", { type: "my_doc", methods: {}, windowMethods: { set_viewport: wm } });
  expect(r.getObjectDefinition("my_doc")?.windowMethods?.set_viewport).toBeDefined();
});

test("lookupWindowMethod resolves via parentClass chain", () => {
  const r = new ObjectRegistry();
  r.registerNewObjectType("base_doc", { type: "base_doc", methods: {}, windowMethods: { set_viewport: wm } });
  r.registerNewObjectType("my_doc", { type: "my_doc", methods: {}, parentClass: "base_doc" });
  expect(r.lookupWindowMethod({ type: "my_doc" }, "set_viewport")).toBeDefined();
});

test("lookupWindowMethod on unknown type returns undefined (no throw)", () => {
  const r = new ObjectRegistry();
  expect(r.lookupWindowMethod({ type: "nope_type" }, "set_viewport")).toBeUndefined();
});

test("seedFrom key-merges windowMethods to per-world registry", () => {
  const src = new ObjectRegistry();
  src.registerReadable("file", { windowMethods: { set_viewport: wm } });
  const world = new ObjectRegistry();
  world.seedFrom(src);
  expect(world.getObjectDefinition("file")?.windowMethods?.set_viewport).toBeDefined();
});

test("collision between object method and window method is rejected (split-call)", () => {
  const r = new ObjectRegistry();
  const om = { paths: ["set_viewport"], intent: () => [], exec: () => undefined } as any;
  // executable 维度先注册 set_viewport 为 object method；readable 维度再注册同名 window method → fail-loud。
  r.registerExecutable("file", { methods: { set_viewport: om } });
  expect(() =>
    r.registerReadable("file", { windowMethods: { set_viewport: wm } }),
  ).toThrow();
});

test("registerExecutable does not clobber readable dimension and vice versa", () => {
  const r = new ObjectRegistry();
  r.registerReadable("file", { windowMethods: { set_viewport: wm } });
  r.registerExecutable("file", { methods: { reload: { paths: ["reload"], intent: () => [], exec: () => undefined } as any } });
  const def = r.getObjectDefinition("file");
  // 两个维度分注册，互不覆盖。
  expect(def?.windowMethods?.set_viewport).toBeDefined();
  expect(def?.methods?.reload).toBeDefined();
});
