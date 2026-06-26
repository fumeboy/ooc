/**
 * 注册期 readable.window cohesion 校验测试（issue 2026-06-26 default window class convention）。
 *
 * 覆盖：
 * 1. 单视角 class 唯一 decl class 非 default → 注册期抛错。
 * 2. 多视角 class 两个 decl class 重复 → 注册期抛错。
 * 3. resolveDefaultWindowClass 命中 default decl（单视角 builtin）。
 * 4. resolveWindowClass(thread, "thread") + resolveWindowClass(thread, "talk") 都非空（多视角 thread）。
 */
import { describe, it, expect } from "bun:test";
import { ClassRegistry, builtinClassRegistry } from "@ooc/core/runtime/object-registry";
import "@ooc/core/runtime/object-register.builtins";
import { THREAD_CLASS_ID } from "@ooc/core/types/constants";
import type { OocClass } from "@ooc/core/runtime/ooc-class.js";

describe("readable.window cohesion (register-time gate)", () => {
  it("fail-loud: single-view class with non-default window class", () => {
    const bad: OocClass = {
      id: "_test/bad-single-view",
      readable: {
        readable: () => ({ class: "wrong_name", content: "" }),
        window: [
          {
            class: "wrong_name", // 单视角 class 必须 "default"
            object_methods: [],
            window_methods: [],
          },
        ],
      },
    };
    const reg = new ClassRegistry();
    expect(() => reg.register(bad)).toThrow(/must declare its sole window with class:"default"/);
  });

  it("fail-loud: multi-view class with duplicate window classes", () => {
    const bad: OocClass = {
      id: "_test/bad-dup-views",
      readable: {
        readable: () => ({ class: "view_a", content: "" }),
        window: [
          { class: "view_a", object_methods: [], window_methods: [] },
          { class: "view_a", object_methods: [], window_methods: [] }, // 重复
        ],
      },
    };
    const reg = new ClassRegistry();
    expect(() => reg.register(bad)).toThrow(/Duplicate window class/);
  });

  it("pass: multi-view class without default (豁免)", () => {
    const ok: OocClass = {
      id: "_test/multi-no-default",
      readable: {
        readable: () => ({ class: "alpha", content: "" }),
        window: [
          { class: "alpha", object_methods: [], window_methods: [] },
          { class: "beta", object_methods: [], window_methods: [] },
        ],
      },
    };
    const reg = new ClassRegistry();
    expect(() => reg.register(ok)).not.toThrow();
  });

  it("pass: single-view class with default", () => {
    const ok: OocClass = {
      id: "_test/single-default",
      readable: {
        readable: () => ({ class: "default", content: "" }),
        window: [{ class: "default", object_methods: [], window_methods: [] }],
      },
    };
    const reg = new ClassRegistry();
    expect(() => reg.register(ok)).not.toThrow();
  });
});

describe("resolveDefaultWindowClass / resolveWindowClass (post-default convention)", () => {
  it("resolveDefaultWindowClass hits default decl on single-view builtin (filesystem)", () => {
    const decl = builtinClassRegistry.resolveDefaultWindowClass("_builtin/filesystem");
    expect(decl).toBeDefined();
    expect(decl?.class).toBe("default");
    expect(decl?.object_methods).toContain("grep");
  });

  it("resolveDefaultWindowClass hits default decl on single-view builtin (agent)", () => {
    const decl = builtinClassRegistry.resolveDefaultWindowClass("_builtin/agent");
    expect(decl).toBeDefined();
    expect(decl?.class).toBe("default");
  });

  it("thread (multi-view, issue I) has 'default', 'self' and 'super' window decls non-empty", () => {
    const defaultDecl = builtinClassRegistry.resolveWindowClass(THREAD_CLASS_ID, "default");
    const selfDecl = builtinClassRegistry.resolveWindowClass(THREAD_CLASS_ID, "self");
    const superDecl = builtinClassRegistry.resolveWindowClass(THREAD_CLASS_ID, "super");
    expect(defaultDecl).toBeDefined();
    expect(selfDecl).toBeDefined();
    expect(superDecl).toBeDefined();
    // default: 对端视角——仅 say
    expect(defaultDecl?.object_methods).toContain("say");
    expect(defaultDecl?.object_methods).not.toContain("reply");
    expect(defaultDecl?.object_methods).not.toContain("end");
    // self: 自看视角——reply/end/todo
    expect(selfDecl?.object_methods).toContain("reply");
    expect(selfDecl?.object_methods).toContain("end");
    expect(selfDecl?.object_methods).toContain("todo");
    expect(selfDecl?.object_methods).not.toContain("say");
    // super: self 全集 + 4 reflect method
    expect(superDecl?.object_methods).toContain("reply");
    expect(superDecl?.object_methods).toContain("end");
    expect(superDecl?.object_methods).toContain("todo");
    expect(superDecl?.object_methods).toContain("scan_changes");
    expect(superDecl?.object_methods).toContain("create_pr_for_versioned");
  });

  it("thread (multi-view, issue I) DOES have a default decl now (default/self/super 三投影)", () => {
    const defaultDecl = builtinClassRegistry.resolveDefaultWindowClass(THREAD_CLASS_ID);
    expect(defaultDecl).toBeDefined();
    expect(defaultDecl?.class).toBe("default");
  });
});
