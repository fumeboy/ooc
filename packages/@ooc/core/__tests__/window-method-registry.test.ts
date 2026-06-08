import { test, expect } from "bun:test";
import { ObjectRegistry } from "../runtime/object-registry.js";
import type { WindowMethod } from "../_shared/types/window-method.js";

const wm: WindowMethod = {
  paths: ["set_viewport"],
  intent: () => [],
  exec: (ctx) => ({ ok: true, state: ctx.windowState }),
};

test("registerObjectType keeps windowMethods on base type", () => {
  const r = new ObjectRegistry();
  r.registerObjectType("file", { methods: {}, windowMethods: { set_viewport: wm } });
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
  src.registerObjectType("file", { methods: {}, windowMethods: { set_viewport: wm } });
  const world = new ObjectRegistry();
  world.seedFrom(src);
  expect(world.getObjectDefinition("file")?.windowMethods?.set_viewport).toBeDefined();
});

test("registerObjectType rejects same name in methods and windowMethods", () => {
  const r = new ObjectRegistry();
  const om = { paths: ["set_viewport"], intent: () => [], exec: () => undefined } as any;
  expect(() =>
    r.registerObjectType("file", { methods: { set_viewport: om }, windowMethods: { set_viewport: wm } }),
  ).toThrow();
});
