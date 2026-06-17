import { test, expect } from "bun:test";
import "@ooc/core/runtime/register-builtins.js"; // 全量 boot：注册 terminal class + 委托目标 terminal_process
import { builtinRegistry } from "@ooc/core/runtime/object-registry.js";
import type { RuntimeHandle } from "@ooc/core/executable/contract.js";

const TERMINAL_PROCESS_CLASS = "_builtin/terminal/terminal_process";

test("terminal executable 维度：run 经 register 注册；readable 在", () => {
  const cls = builtinRegistry.getClass("terminal");
  expect(cls?.executable?.methods.find((m) => m.name === "run")).toBeDefined();
  expect(cls?.readable).toBeDefined();
});

test("terminal 是 tool-object 非 Agent：run 在、agency(say/plan) 不在", () => {
  // run 是 terminal 自己的工具方法。
  expect(builtinRegistry.resolveObjectMethod("terminal", "run")).toBeDefined();
  // tool-object 不继承 agent，无 agency（say 是会话、plan 是 agency）。
  expect(builtinRegistry.resolveObjectMethod("terminal", "say")).toBeUndefined();
  expect(builtinRegistry.resolveObjectMethod("terminal", "plan")).toBeUndefined();
});

test("terminal.run 委托 ctx.runtime.instantiate 造 terminal_process 子对象", async () => {
  const run = builtinRegistry.resolveObjectMethod("terminal", "run")!;
  const instantiated: Array<{ classId: string; args?: Record<string, unknown> }> = [];
  const runtime: RuntimeHandle = {
    instantiate: async (classId, args) => {
      instantiated.push({ classId, args });
      return "w_terminal_process_x";
    },
  };
  const out = await run.exec(
    { runtime, object: { id: "terminal", class: "terminal" }, args: {} } as never,
    {},
    { code: "echo hi" },
  );
  expect(String(out)).toContain("terminal_process 已创建");
  expect(instantiated).toHaveLength(1);
  expect(instantiated[0]!.classId).toBe(TERMINAL_PROCESS_CLASS);
  expect(instantiated[0]!.args?.code).toBe("echo hi");
});

test("terminal.run 缺 runtime 句柄时 fail-loud（本方法名串，非 delegator 未注册）", async () => {
  const run = builtinRegistry.resolveObjectMethod("terminal", "run")!;
  let err = "";
  try {
    await run.exec(
      { object: { id: "terminal", class: "terminal" }, args: {} } as never,
      {},
      { code: "echo hi" },
    );
  } catch (e) {
    err = (e as Error).message;
  }
  expect(err).toContain("[terminal.run]");
  expect(err).not.toContain("未注册");
});
