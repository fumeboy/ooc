import { test, expect } from "bun:test";
import "@ooc/core/runtime/register-builtins.js"; // 全量 boot：注册 filesystem class + 委托目标 search/file
import { builtinRegistry } from "@ooc/core/runtime/object-registry.js";
import { makeSelfProxy, makeReadonlySelfProxy } from "@ooc/core/runtime/self-proxy.js";
import type { RuntimeHandle } from "@ooc/core/types";

function objMethod(classId: string, name: string) {
  const cls = builtinRegistry.getClass(classId);
  return cls?.executable?.methods.find((m) => m.name === name);
}

test("filesystem executable 维度：grep/glob/open_file/write_file 经 register 注册（委托类方法）", () => {
  const cls = builtinRegistry.getClass("filesystem");
  expect(objMethod("filesystem", "grep")).toBeDefined();
  expect(objMethod("filesystem", "glob")).toBeDefined();
  expect(objMethod("filesystem", "open_file")).toBeDefined();
  expect(objMethod("filesystem", "write_file")).toBeDefined();
  expect(cls?.executable?.methods.length).toBe(4);
});

test("filesystem.grep 委托 ctx.runtime.instantiate 造 search 子对象（mode=grep + pattern 入参）", async () => {
  const grep = objMethod("filesystem", "grep")!;
  const instantiated: Array<{ classId: string; args?: Record<string, unknown> }> = [];
  const runtime: RuntimeHandle = {
    instantiate: async (classId, args) => {
      instantiated.push({ classId, args });
      return "w_search_x";
    },
  };
  const out = await grep.exec(
    { runtime, object: { id: "filesystem", class: "filesystem" }, args: {} } as never,
    makeSelfProxy({}, "filesystem", undefined),
    { pattern: "x", path: process.cwd() },
  );
  expect(String(out)).toContain("opened search (grep)");
  expect(instantiated).toHaveLength(1);
  expect(instantiated[0]!.classId).toBe("_builtin/filesystem/search");
  expect(instantiated[0]!.args?.mode).toBe("grep");
  expect(instantiated[0]!.args?.pattern).toBe("x");
});

test("filesystem.glob 委托 search：glob 通配符走 pattern 入参 + 显式 mode=glob", async () => {
  const glob = objMethod("filesystem", "glob")!;
  const instantiated: Array<{ classId: string; args?: Record<string, unknown> }> = [];
  const runtime: RuntimeHandle = {
    instantiate: async (classId, args) => {
      instantiated.push({ classId, args });
      return "w_search_g";
    },
  };
  await glob.exec(
    { runtime, object: { id: "filesystem", class: "filesystem" }, args: {} } as never,
    makeSelfProxy({}, "filesystem", undefined),
    { pattern: "**/*.ts" },
  );
  expect(instantiated).toHaveLength(1);
  expect(instantiated[0]!.classId).toBe("_builtin/filesystem/search");
  expect(instantiated[0]!.args?.mode).toBe("glob");
  expect(instantiated[0]!.args?.pattern).toBe("**/*.ts");
});

test("filesystem.grep 缺 runtime 句柄时 fail-loud（本方法名串，非 delegator 未注册）", async () => {
  const grep = objMethod("filesystem", "grep")!;
  let err = "";
  try {
    await grep.exec({ object: { id: "filesystem", class: "filesystem" }, args: {} } as never, makeSelfProxy({}, "filesystem", undefined), {
      pattern: "x",
    });
  } catch (e) {
    err = (e as Error).message;
  }
  expect(err).toContain("[filesystem.grep]");
  expect(err).not.toContain("未注册");
});

test("filesystem readable 维度：readable 经 register 注册（投影 class=filesystem）", () => {
  const cls = builtinRegistry.getClass("filesystem");
  expect(cls?.readable).toBeDefined();
  const proj = cls!.readable!.readable(
    { object: { id: "filesystem", class: "filesystem" } } as never,
    makeReadonlySelfProxy({}),
    {},
  );
  expect((proj as { class: string }).class).toBe("filesystem");
});

test("filesystem readable 渲染身份说明", () => {
  const cls = builtinRegistry.getClass("filesystem");
  const proj = cls!.readable!.readable(
    { object: { id: "filesystem", class: "filesystem" } } as never,
    makeReadonlySelfProxy({}),
    {},
  ) as { class: string; content: unknown };
  expect(String(proj.content)).toContain("文件系统");
});
