/**
 * registry.test — Round 10 F3.
 *
 * Registry 是 type-dispatch 的核心；这里覆盖：
 *   - register / get 正常路径
 *   - 同 type 重复注册 = 覆盖（idempotent）
 *   - 未注册返回 undefined（调用方决定 fallback）
 *   - reset 清空所有注册
 *   - list 列出已注册 type
 *   - side-effect import "./window-diff-renderers" 注册 9 种 type
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  getWindowDiffRenderer,
  listRegisteredDiffRenderers,
  registerWindowDiffRenderer,
  resetWindowDiffRegistry,
} from "./registry";

describe("registry — register / get / reset", () => {
  beforeEach(() => {
    resetWindowDiffRegistry();
  });
  afterEach(() => {
    resetWindowDiffRegistry();
  });

  it("Case 1: register + get → 取回同一函数", () => {
    const fake = () => null;
    registerWindowDiffRenderer("custom_test", fake);
    expect(getWindowDiffRenderer("custom_test")).toBe(fake);
  });

  it("Case 2: 未注册 type → get 返回 undefined", () => {
    expect(getWindowDiffRenderer("nope")).toBeUndefined();
  });

  it("Case 3: 重复 register 同 type → 后注册者覆盖", () => {
    const first = () => null;
    const second = () => null;
    registerWindowDiffRenderer("dup", first);
    registerWindowDiffRenderer("dup", second);
    expect(getWindowDiffRenderer("dup")).toBe(second);
  });

  it("Case 4: list 返回已注册 keys", () => {
    registerWindowDiffRenderer("a", () => null);
    registerWindowDiffRenderer("b", () => null);
    const list = listRegisteredDiffRenderers();
    expect(list).toContain("a");
    expect(list).toContain("b");
  });

  it("Case 5: reset 后所有注册消失", () => {
    registerWindowDiffRenderer("x", () => null);
    expect(getWindowDiffRenderer("x")).toBeDefined();
    resetWindowDiffRegistry();
    expect(getWindowDiffRenderer("x")).toBeUndefined();
    expect(listRegisteredDiffRenderers()).toEqual([]);
  });
});

// Note: Case 6 (side-effect index import) was removed in Task 5c cleanup.
// The index.ts + 9 typed renderer files were deleted as dead code;
// dispatch is now handled by resolveWindowDiff (window-diff/resolveWindowDiff.tsx).
// Registry itself is kept because ErrorBoundary.tsx and FallbackJsonDiff.tsx
// still import the WindowDiffRendererProps type from it.
