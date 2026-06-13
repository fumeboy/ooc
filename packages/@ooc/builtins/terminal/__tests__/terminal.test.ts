import { test, expect } from "bun:test";
import "@ooc/builtins/terminal"; // side-effect: registerExecutable + registerReadable
import { builtinRegistry } from "@ooc/core/runtime/object-registry.js";

test("terminal executable 维度：program 经 registerExecutable 注册", () => {
  const def = builtinRegistry.getObjectDefinition("terminal");
  expect(def.methods?.program).toBeDefined();
  expect(def.readable).toBeDefined();
});

test("terminal 是 tool-object 非 Agent：program 在、agency(talk/do) 不在", () => {
  expect(builtinRegistry.resolveMethod("terminal", "program")).toBeDefined();
  expect(builtinRegistry.resolveMethod("terminal", "talk")).toBeUndefined();
  expect(builtinRegistry.resolveMethod("terminal", "do")).toBeUndefined();
});

test("terminal.program 经委托链到达 program constructor（非未注册）", async () => {
  const def = builtinRegistry.getObjectDefinition("terminal");
  const out = (await def.methods!.program!.exec({
    args: { language: "shell", code: "echo hi" },
    manager: { registry: builtinRegistry },
  } as any)) as { ok?: boolean; error?: string };
  // 委托已到达 program constructor（其 fail-loud 含 "[program]" 或需 thread context），非 delegator 的未注册串。
  expect(String(JSON.stringify(out))).not.toContain("未注册");
});
