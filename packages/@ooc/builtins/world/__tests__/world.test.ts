import { test, expect } from "bun:test";
import "@ooc/builtins/world"; // side-effect: registerExecutable + registerReadable
import { builtinRegistry } from "@ooc/core/runtime/object-registry.js";

test("world executable 维度：create_object 经 registerExecutable 注册（从 root 迁来）", () => {
  const def = builtinRegistry.getObjectDefinition("world");
  expect(def.methods?.create_object).toBeDefined();
  expect(def.methods?.create_object?.intents).toEqual(["create_object"]);
});

test("world.create_object fail-loud：缺 thread context 报本方法的错（非 delegator 未注册）", async () => {
  const def = builtinRegistry.getObjectDefinition("world");
  const create = def.methods?.create_object;
  const out = (await create!.exec({ args: { objectId: "x" } } as any)) as unknown;
  expect(String(out)).toContain("[create_object]");
  expect(String(out)).toContain("thread");
});

test("world readable 维度：readable 经 registerReadable 注册（boot 校验要求）", () => {
  const def = builtinRegistry.getObjectDefinition("world");
  expect(def.readable).toBeDefined();
});

test("world readable 渲染身份说明", async () => {
  const { readable } = await import("@ooc/builtins/world/readable.js");
  const nodes = readable({ window: { class: "world" }, thread: {} } as any);
  const about = nodes.find((n: any) => n.tag === "about") as any;
  expect(about?.children?.[0]?.value).toContain("world");
});
