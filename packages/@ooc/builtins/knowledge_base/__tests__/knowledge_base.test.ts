import { test, expect } from "bun:test";
import "@ooc/core/runtime/register-builtins.js"; // 全量 boot：注册 knowledge_base class + 委托目标 knowledge
import { builtinRegistry } from "@ooc/core/runtime/object-registry.js";
import { KNOWLEDGE_CLASS_ID } from "@ooc/core/types/constants.js";
import type { RuntimeHandle } from "@ooc/core/types";
import { makeSelfProxy, makeReadonlySelfProxy } from "@ooc/core/runtime/self-proxy.js";

function objMethod(name: string) {
  return builtinRegistry.getClass("knowledge_base")?.executable?.methods.find((m) => m.name === name);
}

test("knowledge_base executable 维度：open_knowledge 经 register 注册（从 root 迁来）", () => {
  expect(objMethod("open_knowledge")).toBeDefined();
});

test("knowledge_base.open_knowledge 委托 ctx.runtime.instantiate 造 knowledge 子对象（stored class=KNOWLEDGE_CLASS_ID）", async () => {
  const open = objMethod("open_knowledge")!;
  const instantiated: Array<{ classId: string; args?: Record<string, unknown> }> = [];
  const runtime: RuntimeHandle = {
    instantiate: async (classId, args) => {
      instantiated.push({ classId, args });
      return "w_knowledge_x";
    },
  };
  const out = await open.exec(
    { runtime, object: { id: "knowledge_base", class: "knowledge_base" }, args: {} } as never,
    makeSelfProxy({}, "knowledge_base", undefined),
    { path: "x" },
  );
  expect(String(out)).toContain("opened knowledge");
  expect(instantiated).toHaveLength(1);
  // 委托目标用注册 class id（不是裸名 "knowledge" 投影名）。
  expect(instantiated[0]!.classId).toBe(KNOWLEDGE_CLASS_ID);
});

test("knowledge_base.open_knowledge 缺 runtime 句柄时 fail-loud（本方法名串，非 delegator 未注册）", async () => {
  const open = objMethod("open_knowledge")!;
  let err = "";
  try {
    await open.exec(
      { object: { id: "knowledge_base", class: "knowledge_base" }, args: {} } as never,
      makeSelfProxy({}, "knowledge_base", undefined),
      { path: "x" },
    );
  } catch (e) {
    err = (e as Error).message;
  }
  expect(err).toContain("[open_knowledge]");
  expect(err).not.toContain("未注册");
});

test("knowledge_base readable 维度：readable 经 register 注册（投影 class=knowledge_base）", () => {
  const cls = builtinRegistry.getClass("knowledge_base");
  expect(cls?.readable).toBeDefined();
  const proj = cls!.readable!.readable(
    { object: { id: "knowledge_base", class: "knowledge_base" } } as never,
    makeReadonlySelfProxy({}),
    {},
  );
  expect((proj as { class: string }).class).toBe("knowledge_base");
});

test("knowledge_base readable 渲染身份说明", () => {
  const cls = builtinRegistry.getClass("knowledge_base");
  const proj = cls!.readable!.readable(
    { object: { id: "knowledge_base", class: "knowledge_base" } } as never,
    makeReadonlySelfProxy({}),
    {},
  ) as { class: string; content: any[] };
  const about = proj.content.find((n: any) => n.tag === "about");
  const text = about?.children?.[0]?.value as string;
  expect(text).toContain("知识库");
});
