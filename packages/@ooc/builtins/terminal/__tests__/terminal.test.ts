import { test, expect } from "bun:test";
import "@ooc/builtins/terminal"; // side-effect: registerWindowClass
import { builtinRegistry } from "@ooc/core/runtime/object-registry.js";

test("terminal executable 维度：run 经 registerWindowClass 注册", () => {
  const def = builtinRegistry.getObjectDefinition("terminal");
  expect(def.methods?.run).toBeDefined();
  expect(def.readable).toBeDefined();
});

test("terminal 是 tool-object 非 Agent：run 在、agency(talk/plan) 不在", () => {
  expect(builtinRegistry.resolveMethod("terminal", "run")).toBeDefined();
  expect(builtinRegistry.resolveMethod("terminal", "talk")).toBeUndefined();
  expect(builtinRegistry.resolveMethod("terminal", "plan")).toBeUndefined();
});

test("terminal.run 经委托链到达 terminal_process constructor（非未注册）", async () => {
  const def = builtinRegistry.getObjectDefinition("terminal");
  const out = (await def.methods!.run!.exec({
    args: { code: "echo hi" },
    manager: { registry: builtinRegistry },
  } as any)) as { ok?: boolean; error?: string };
  // 委托已到达 terminal_process constructor（非 delegator 的未注册串）。
  expect(String(JSON.stringify(out))).not.toContain("未注册");
});
