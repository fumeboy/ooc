/**
 * P6.§7 (2026-06-02): resolveMethod 沿 ObjectDefinition.parentClass 链向上回退。
 *
 * 三态语义验证：
 *   - undefined（缺省）→ 默认隐式 "root"，subclass 自动拿到 root 上的 methods
 *   - null（显式不继承）→ 链终止；subclass 上找不到方法时立即返回 undefined
 *   - string（具名父类）→ 跳到该 class 继续查；环检测兜底
 */
import { describe, expect, test } from "bun:test";
// Side-effect import: ensures `root` is registered with ROOT_METHODS (talk/do/todo/...)
// so resolveMethod chains can find them. Without this, the registry has the empty stub
// from registry.ts:207 and "talk" lookups miss.
import "@ooc/builtins/root/executable/index.js";
import { builtinRegistry } from "../registry";
import type { ObjectMethod } from "../method-types";

const fakeMethod: ObjectMethod = {
  description: "dummy test method",
  intents: ["dummy"],
  permission: () => "allow",
  exec: async () => ({ ok: true, result: "dummy" }),
};

// 给测试用 type 配 stub readable，让 assertAllObjectDefinitionsRegistered 通过——
// 该 assert 在其他测试文件 import windows/index.ts 时运行，会扫描整个 REGISTRY。
const stubReadable = () => [];

describe("resolveMethod + parentClass chain (P6.§7)", () => {
  test("undefined parentClass → defaults to \"root\" → finds talk", () => {
    const t = `__test_default_root_${Date.now()}`;
    builtinRegistry.registerNewObjectType(t as never, { methods: {}, readable: stubReadable });
    const found = builtinRegistry.resolveMethod(t, "talk");
    expect(found).toBeDefined();
    expect(found?.description).toBeTruthy();
  });

  test("explicit parentClass: null → no inheritance → not found", () => {
    const t = `__test_no_inherit_${Date.now()}`;
    builtinRegistry.registerNewObjectType(t as never, { methods: {}, parentClass: null, readable: stubReadable });
    const found = builtinRegistry.resolveMethod(t, "talk");
    expect(found).toBeUndefined();
  });

  test("explicit parentClass: \"root\" → resolves talk via parent", () => {
    const t = `__test_explicit_root_${Date.now()}`;
    builtinRegistry.registerNewObjectType(t as never, { methods: {}, parentClass: "root", readable: stubReadable });
    const found = builtinRegistry.resolveMethod(t, "talk");
    expect(found).toBeDefined();
    expect(found?.description).toBeTruthy();
  });

  test("nonexistent method on chain → undefined", () => {
    const t = `__test_missing_method_${Date.now()}`;
    builtinRegistry.registerNewObjectType(t as never, { methods: {}, readable: stubReadable });
    const found = builtinRegistry.resolveMethod(t, "no_such_method_anywhere");
    expect(found).toBeUndefined();
  });

  test("cycle detection: A→B→A → terminates and returns undefined", () => {
    const a = `__test_cycle_a_${Date.now()}`;
    const b = `__test_cycle_b_${Date.now()}`;
    builtinRegistry.registerNewObjectType(a as never, { methods: {}, parentClass: b, readable: stubReadable });
    builtinRegistry.registerNewObjectType(b as never, { methods: {}, parentClass: a, readable: stubReadable });
    const found = builtinRegistry.resolveMethod(a, "talk");
    expect(found).toBeUndefined();
  });

  test("self-declared method wins over parent's", () => {
    const t = `__test_override_${Date.now()}`;
    builtinRegistry.registerNewObjectType(t as never, {
      methods: { my_local: fakeMethod },
      parentClass: "root",
      readable: stubReadable,
    });
    const local = builtinRegistry.resolveMethod(t, "my_local");
    expect(local).toBe(fakeMethod);
    const inherited = builtinRegistry.resolveMethod(t, "talk");
    expect(inherited).toBeDefined();
    expect(inherited?.description).toBeTruthy();
  });

  test("lookupMethod (parent.type API) walks chain identically", () => {
    const t = `__test_via_window_${Date.now()}`;
    builtinRegistry.registerNewObjectType(t as never, { methods: {}, readable: stubReadable });
    const found = builtinRegistry.lookupMethod({ type: t as never }, "talk");
    expect(found).toBeDefined();
    expect(found?.description).toBeTruthy();
  });

  test("root itself: parentClass null prevents infinite loop", () => {
    const found = builtinRegistry.resolveMethod("root", "talk");
    expect(found).toBeDefined();
    const missing = builtinRegistry.resolveMethod("root", "no_method_at_all");
    expect(missing).toBeUndefined();
  });
});
