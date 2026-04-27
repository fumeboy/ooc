/**
 * Phase 2 MethodRegistry 测试
 *
 * 新协议：
 * - key = (traitId, methodName, channel)
 * - buildSandboxMethods 只暴露 `callMethod(traitIdRaw, methodName, args)` 单函数
 * - 沙箱只能调 llm_methods；ui_methods 由 HTTP /call_method 端点调（Phase 4）
 */

import { describe, test, expect } from "bun:test";
import { MethodRegistry } from "../src/extendable/trait/registry.js";
import type { TraitMethod } from "../src/shared/types/index.js";

/** 构造一个最小化的 TraitMethod */
function mkMethod(fn: (ctx: any, args: any) => Promise<unknown>): TraitMethod {
  return {
    name: "_",
    description: "",
    params: [],
    fn: fn as TraitMethod["fn"],
  };
}

describe("MethodRegistry Phase 2 双通道", () => {
  test("key 是 (traitId, methodName, channel) 三元组", () => {
    const r = new MethodRegistry();
    r.register("kernel:computable", "readFile", mkMethod(async () => "hi"), "llm");
    expect(r.get("kernel:computable", "readFile", "llm")).toBeDefined();
    expect(r.get("kernel:computable", "readFile", "ui")).toBeUndefined();
  });

  test("llm 和 ui 方法严格隔离（同 traitId + method + 不同 channel）", () => {
    const r = new MethodRegistry();
    r.register("self:report", "submit", mkMethod(async () => "ok"), "ui");
    expect(r.get("self:report", "submit", "ui")).toBeDefined();
    expect(r.get("self:report", "submit", "llm")).toBeUndefined();
  });

  test("getUiMethod 快捷方法只从 ui 通道读", () => {
    const r = new MethodRegistry();
    r.register("self:report", "submit", mkMethod(async () => "ok"), "ui");
    r.register("self:report", "parse", mkMethod(async () => "llm-parsed"), "llm");
    expect(r.getUiMethod("self:report", "submit")).toBeDefined();
    expect(r.getUiMethod("self:report", "parse")).toBeUndefined();
  });

  test("buildSandboxMethods 只暴露 callMethod 单函数", () => {
    const r = new MethodRegistry();
    r.register(
      "kernel:computable",
      "readFile",
      mkMethod(async (_ctx, { path }: { path: string }) => `read ${path}`),
      "llm",
    );
    const api = r.buildSandboxMethods({} as any, "supervisor");
    expect(Object.keys(api)).toEqual(["callMethod"]);
    expect(typeof api.callMethod).toBe("function");
  });

  test("callMethod 传递对象 args 并 await 返回值", async () => {
    const r = new MethodRegistry();
    r.register(
      "kernel:computable",
      "readFile",
      mkMethod(async (_ctx, { path }: any) => `read ${path}`),
      "llm",
    );
    const api = r.buildSandboxMethods({} as any, "supervisor");
    const result = await (api.callMethod as any)("kernel:computable", "readFile", { path: "foo.md" });
    expect(result).toBe("read foo.md");
  });

  test("callMethod 省略 namespace 按 self → kernel → library 解析", async () => {
    const r = new MethodRegistry();
    r.register("self:foo", "do", mkMethod(async () => "self"), "llm");
    r.register("kernel:foo", "do", mkMethod(async () => "kernel"), "llm");
    r.register("library:foo", "do", mkMethod(async () => "library"), "llm");
    const api = r.buildSandboxMethods({} as any, "supervisor");

    // 省略 namespace → self 优先
    expect(await (api.callMethod as any)("foo", "do", {})).toBe("self");
    // 显式 namespace 精确匹配
    expect(await (api.callMethod as any)("kernel:foo", "do", {})).toBe("kernel");
    expect(await (api.callMethod as any)("library:foo", "do", {})).toBe("library");
  });

  test("callMethod 省略 namespace 且 self 无，fallback 到 kernel", async () => {
    const r = new MethodRegistry();
    r.register("kernel:bar", "do", mkMethod(async () => "kernel"), "llm");
    const api = r.buildSandboxMethods({} as any, "supervisor");
    expect(await (api.callMethod as any)("bar", "do", {})).toBe("kernel");
  });

  test("callMethod 省略 namespace 且 self+kernel 无，fallback 到 library", async () => {
    const r = new MethodRegistry();
    r.register("library:baz", "do", mkMethod(async () => "library"), "llm");
    const api = r.buildSandboxMethods({} as any, "supervisor");
    expect(await (api.callMethod as any)("baz", "do", {})).toBe("library");
  });

  test("callMethod 找不到方法时抛描述清楚的错误", async () => {
    const r = new MethodRegistry();
    const api = r.buildSandboxMethods({} as any, "supervisor");
    await expect(
      (api.callMethod as any)("kernel:x", "y", {}),
    ).rejects.toThrow(/callMethod.*kernel:x.*y.*not found/);
  });

  test("callMethod 不能调用 ui_methods", async () => {
    const r = new MethodRegistry();
    r.register("self:report", "submit", mkMethod(async () => "ui"), "ui");
    const api = r.buildSandboxMethods({} as any, "supervisor");
    await expect(
      (api.callMethod as any)("self:report", "submit", {}),
    ).rejects.toThrow(/not found/);
  });

  test("callMethod 默认 args 为空对象", async () => {
    const r = new MethodRegistry();
    r.register(
      "kernel:x",
      "y",
      mkMethod(async (_ctx, args) => args),
      "llm",
    );
    const api = r.buildSandboxMethods({} as any, "supervisor");
    const result = await (api.callMethod as any)("kernel:x", "y");
    expect(result).toEqual({});
  });

  test("registerAll 支持新的 llmMethods / uiMethods 双通道", () => {
    const r = new MethodRegistry();
    r.registerAll([
      {
        namespace: "self",
        name: "report",
        kind: "view",
        type: "how_to_interact",
        description: "",
        readme: "",
        deps: [],
        llmMethods: {
          parse: { name: "parse", description: "", params: [], fn: async () => "llm-parsed" },
        },
        uiMethods: {
          submit: { name: "submit", description: "", params: [], fn: async () => "ui-submit" },
        },
      } as any,
    ]);
    expect(r.get("self:report", "parse", "llm")).toBeDefined();
    expect(r.get("self:report", "submit", "ui")).toBeDefined();
    expect(r.get("self:report", "parse", "ui")).toBeUndefined();
    expect(r.get("self:report", "submit", "llm")).toBeUndefined();
  });
});
