import { test, expect } from "bun:test";
import "@ooc/core/runtime/register-builtins.js"; // 全量 boot（example 不在 register-builtins，下方直接装 Class）
import { builtinRegistry } from "@ooc/core/runtime/object-registry.js";
import { Class as ExampleClass } from "@ooc/builtins/example/index.js";
import type { Data } from "@ooc/builtins/example/types.js";
import type { ExampleWin } from "@ooc/builtins/example/readable/index.js";

// example 是样板 class，未进 register-builtins 全量装载——本测试经 Class export 直接驱动各维度。
builtinRegistry.register("_builtin/example", ExampleClass);

function objMethod(name: string) {
  return builtinRegistry.getClass("example")?.executable?.methods.find((m) => m.name === name);
}

test("example executable 维度：object method bump + 独立 construct 槽位", () => {
  expect(objMethod("bump")).toBeDefined();
  // construct 升为 OocClass.construct 独立槽位（不再是名为 example 的 method，亦无旧 close method）。
  expect(objMethod("example")).toBeUndefined();
  expect(builtinRegistry.resolveConstructor("example")).toBeDefined();
  expect(ExampleClass.construct).toBeDefined();
});

test("example readable 维度：readable 在；set_viewport 是 window method 不混进 object method", () => {
  const cls = builtinRegistry.getClass("example");
  expect(cls?.readable).toBeDefined();
  // 维度隔离：set_viewport 是 window method（动投影态 win）。
  expect(builtinRegistry.resolveWindowMethod("example", "set_viewport")).toBeDefined();
  expect(objMethod("set_viewport")).toBeUndefined();
});

test("example construct 产出初始 Data，bump 累加业务数据（self.bumpCount）", async () => {
  const ctor = builtinRegistry.resolveConstructor("example")!;
  const data = (await ctor.exec({ args: {} } as never, { message: "hi\nthere" })) as Data;
  expect(data.message).toBe("hi\nthere");
  expect(data.bumpCount).toBe(0);

  // bump object method：可改 self（Data）。
  await objMethod("bump")!.exec({ object: { id: "x", class: "example" }, args: {} } as never, data, {});
  expect(data.bumpCount).toBe(1);
});

test("example readable 渲染 bump_count + viewport 切片后的 message", () => {
  const cls = builtinRegistry.getClass("example");
  const self: Data = { message: "line0\nline1\nline2", bumpCount: 3 };
  const win: ExampleWin = { viewport: { lineStart: 0, lineEnd: 1, columnStart: 0, columnEnd: 80 } };
  const proj = cls!.readable!.readable({} as never, self, win) as { class: string; content: any[] };
  const bump = proj.content.find((n: any) => n.tag === "bump_count");
  expect(bump?.children?.[0]?.value).toBe("3");
  const message = proj.content.find((n: any) => n.tag === "message");
  // viewport line_end=1 → 只切出第一行 "line0"，其余行被折叠。
  const text = message?.children?.[0]?.value as string;
  expect(text.startsWith("line0")).toBe(true);
  expect(text).not.toContain("line1");
});
