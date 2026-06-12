import { test, expect } from "bun:test";
import "@ooc/builtins/filesystem"; // side-effect: registerExecutable + registerReadable
import { builtinRegistry } from "@ooc/core/runtime/object-registry.js";

test("filesystem executable 维度：grep/glob/open_file/write_file 经 registerExecutable 注册（复用 root 方法）", () => {
  const def = builtinRegistry.getObjectDefinition("filesystem");
  expect(def.methods?.grep).toBeDefined();
  expect(def.methods?.glob).toBeDefined();
  expect(def.methods?.open_file).toBeDefined();
  expect(def.methods?.write_file).toBeDefined();
});

test("filesystem.grep 经委托链造 search 对象（与 root.grep 同一 constructorKind=search）", async () => {
  const def = builtinRegistry.getObjectDefinition("filesystem");
  const grep = def.methods?.grep;
  expect(grep?.intents).toEqual(["grep"]);
  // 委托：lookupConstructor("search") 命中 → exec 返回 search constructor 的 {ok,window}。
  const out = (await grep!.exec({
    args: { pattern: "x", path: process.cwd() },
    manager: { registry: builtinRegistry },
  } as any)) as { ok?: boolean; error?: string };
  // 委托已到达 search constructor（其 fail-loud 是 "[search] 缺少 thread context"，
  // 而非 delegator 的 "constructor 未注册"）。完整 thread→search 窗见 storybook TC-COMP-04。
  expect(String(out?.error)).toContain("[search]");
  expect(String(out?.error)).not.toContain("未注册");
});

test("filesystem readable 维度：readable 经 registerReadable 注册（boot 校验要求）", () => {
  const def = builtinRegistry.getObjectDefinition("filesystem");
  expect(def.readable).toBeDefined();
});

test("filesystem readable 渲染身份说明", async () => {
  const { readable } = await import("@ooc/builtins/filesystem/readable.js");
  const nodes = readable({ window: { class: "filesystem" }, thread: {} } as any);
  const about = nodes.find((n: any) => n.tag === "about") as any;
  expect(about?.children?.[0]?.value).toContain("文件系统");
});
