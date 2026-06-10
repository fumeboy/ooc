import { test, expect } from "bun:test";
import { ObjectRegistry } from "../runtime/object-registry.js";
import type { WindowMethod } from "../_shared/types/window-method.js";

const wm: WindowMethod = {
  description: "test method", intents: ["set_viewport"],
  exec: (ctx) => ({ ok: true, state: ctx.windowState }),
};

test("registerReadable keeps windowMethods on base type", () => {
  const r = new ObjectRegistry();
  r.registerReadable("file", { windowMethods: { set_viewport: wm } });
  expect(r.getObjectDefinition("file")?.windowMethods?.set_viewport).toBeDefined();
});

test("registerNewObjectType carries windowMethods", () => {
  const r = new ObjectRegistry();
  r.registerNewObjectType("my_doc", { methods: {}, windowMethods: { set_viewport: wm } });
  expect(r.getObjectDefinition("my_doc")?.windowMethods?.set_viewport).toBeDefined();
});

test("lookupWindowMethod resolves via parentClass chain", () => {
  const r = new ObjectRegistry();
  r.registerNewObjectType("base_doc", { methods: {}, windowMethods: { set_viewport: wm } });
  r.registerNewObjectType("my_doc", { methods: {}, parentClass: "base_doc" });
  expect(r.lookupWindowMethod({ class: "my_doc" }, "set_viewport")).toBeDefined();
});

test("lookupWindowMethod on unknown type returns undefined (no throw)", () => {
  const r = new ObjectRegistry();
  expect(r.lookupWindowMethod({ class: "nope_type" }, "set_viewport")).toBeUndefined();
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
  // executable 维度先注册 set_viewport 为 object method；readable 维度再注册同名 window method → fail-loud。
  const om = { description: "test", intents: ["set_viewport"], exec: () => undefined } as any;
  r.registerExecutable("file", { methods: { set_viewport: om } });
  expect(() =>
    r.registerReadable("file", { windowMethods: { set_viewport: wm } }),
  ).toThrow();
});

test("registerExecutable does not clobber readable dimension and vice versa", () => {
  const r = new ObjectRegistry();
  const om = { description: "test", exec: () => undefined } as any;
  // 两个维度分注册，互不覆盖（任意先后顺序）。
  r.registerExecutable("file", { methods: { reload: om } });
  r.registerReadable("file", { windowMethods: { set_viewport: wm } });
  const def = r.getObjectDefinition("file");
  expect(def?.windowMethods?.set_viewport).toBeDefined();
  expect(def?.methods?.reload).toBeDefined();

  const r2 = new ObjectRegistry();
  r2.registerReadable("file", { windowMethods: { set_viewport: wm } });
  r2.registerExecutable("file", { methods: { reload: om } });
  const def2 = r2.getObjectDefinition("file");
  expect(def2?.windowMethods?.set_viewport).toBeDefined();
  expect(def2?.methods?.reload).toBeDefined();
});
