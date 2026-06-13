import { test, expect } from "bun:test";
import "@ooc/builtins/knowledge_base"; // side-effect: registerExecutable + registerReadable
import { builtinRegistry } from "@ooc/core/runtime/object-registry.js";

test("knowledge_base executable 维度：open_knowledge 经 registerExecutable 注册（从 root 迁来）", () => {
  const def = builtinRegistry.getObjectDefinition("knowledge_base");
  expect(def.methods?.open_knowledge).toBeDefined();
  expect(def.methods?.open_knowledge?.intents).toEqual(["open_knowledge"]);
});

test("knowledge_base.open_knowledge 经委托链到 knowledge constructor（非 delegator 未注册）", async () => {
  const def = builtinRegistry.getObjectDefinition("knowledge_base");
  const open = def.methods?.open_knowledge;
  // 委托已到达 knowledge constructor（其 fail-loud 含 "knowledge"），而非 delegator 的 "constructor 未注册"。
  const out = (await open!.exec({
    args: { path: "x" },
    manager: { registry: builtinRegistry },
  } as any)) as { ok?: boolean; error?: string };
  expect(String(out?.error)).not.toContain("未注册");
});

test("knowledge_base readable 维度：readable 经 registerReadable 注册（boot 校验要求）", () => {
  const def = builtinRegistry.getObjectDefinition("knowledge_base");
  expect(def.readable).toBeDefined();
});

test("knowledge_base readable 渲染身份说明", async () => {
  const { readable } = await import("@ooc/builtins/knowledge_base/readable.js");
  const nodes = readable({ window: { class: "knowledge_base" }, thread: {} } as any);
  const about = nodes.find((n: any) => n.tag === "about") as any;
  expect(about?.children?.[0]?.value).toContain("知识库");
});
