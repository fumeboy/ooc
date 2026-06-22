import { test, expect } from "bun:test";
import "@ooc/core/runtime/register-builtins.js"; // 全量 boot：注册 runtime class
import { builtinRegistry } from "@ooc/core/runtime/object-registry.js";
import { makeSelfProxy, makeReadonlySelfProxy } from "@ooc/core/runtime/self-proxy.js";

function objMethod(name: string) {
  return builtinRegistry.getClass("runtime")?.executable?.methods.find((m) => m.name === name);
}

test("runtime executable 维度：create_object 经 register 注册（从 root 迁来）", () => {
  expect(objMethod("create_object")).toBeDefined();
});

test("runtime.create_object fail-loud：缺 persistence context 报本方法的错（非 delegator 未注册）", async () => {
  const create = objMethod("create_object")!;
  // exec(ctx, self, args)：缺 persistence → 返回本方法的错串（不 throw）。
  const out = (await create.exec(
    { object: { id: "runtime", class: "runtime" }, args: {} } as never,
    makeSelfProxy({}, "runtime", undefined),
    { objectId: "x" },
  )) as unknown;
  expect(String(out)).toContain("[create_object]");
  expect(String(out)).toContain("persistence");
});

test("runtime readable 维度：readable 经 register 注册（投影 class=runtime）", () => {
  const cls = builtinRegistry.getClass("runtime");
  expect(cls?.readable).toBeDefined();
  const proj = cls!.readable!.readable(
    { object: { id: "runtime", class: "runtime" } } as never,
    makeReadonlySelfProxy({}),
    {},
  );
  expect((proj as { class: string }).class).toBe("runtime");
});

test("runtime readable 渲染身份说明", () => {
  const cls = builtinRegistry.getClass("runtime");
  const proj = cls!.readable!.readable(
    { object: { id: "runtime", class: "runtime" } } as never,
    makeReadonlySelfProxy({}),
    {},
  ) as { class: string; content: any[] };
  const about = proj.content.find((n: any) => n.tag === "about");
  const text = about?.children?.[0]?.value as string;
  expect(text).toContain("runtime");
});
