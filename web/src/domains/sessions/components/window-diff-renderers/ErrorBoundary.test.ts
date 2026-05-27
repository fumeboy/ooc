/**
 * ErrorBoundary.test — Round 10 F3.
 *
 * Web 无 RTL；这里测 boundary 的 contract：
 *   - getDerivedStateFromError 返回 hasError + message
 *   - 实例 render 在 hasError=true 时输出 fallback 树（含 error message + FallbackJsonDiff 节点）
 *   - 不静默：componentDidCatch 走 console.warn 含 windowType / windowId
 */

import { describe, expect, it, mock } from "bun:test";
import { DiffRendererErrorBoundary } from "./ErrorBoundary";
import { containsText, findTestId } from "./test-utils";

describe("DiffRendererErrorBoundary", () => {
  it("Case 1: getDerivedStateFromError 提取 error.message", () => {
    const err = new Error("boom");
    const next = (DiffRendererErrorBoundary as any).getDerivedStateFromError(err);
    expect(next.hasError).toBe(true);
    expect(next.message).toBe("boom");
  });

  it("Case 2: getDerivedStateFromError 对非 Error 调用 String()", () => {
    const next = (DiffRendererErrorBoundary as any).getDerivedStateFromError("plain string");
    expect(next.hasError).toBe(true);
    expect(next.message).toBe("plain string");
  });

  it("Case 3: hasError=true 时 render 输出 fallback 树", () => {
    const instance = new DiffRendererErrorBoundary({
      previous: { a: 1 },
      current: { a: 2 },
      windowType: "talk",
      windowId: "w_eb_1",
      children: null,
    });
    instance.state = { hasError: true, message: "renderer crashed" };
    const tree = instance.render();
    expect(tree).toBeDefined();
    // tree 含 error 字串 + 错误兜底容器 testid + FallbackJsonDiff 元素（test-utils 会展开 component element）
    expect(containsText(tree, "renderer crashed")).toBe(true);
    expect(findTestId(tree, "window-diff-renderer-error-w_eb_1")).toBe(true);
    // FallbackJsonDiff 展开后会在内部输出 data-testid="window-diff-fallback-<id>"
    expect(findTestId(tree, "window-diff-fallback-w_eb_1")).toBe(true);
  });

  it("Case 4: hasError=false 时 render 直出 children", () => {
    const sentinel: unknown = { type: "x" };
    const instance = new DiffRendererErrorBoundary({
      previous: {},
      current: {},
      windowType: "talk",
      windowId: "w_eb_2",
      children: sentinel as React.ReactNode,
    });
    instance.state = { hasError: false, message: undefined };
    const tree = instance.render();
    expect(tree as unknown).toBe(sentinel);
  });

  it("Case 5: componentDidCatch 调用 console.warn 含 windowType / windowId", () => {
    const origWarn = console.warn;
    const warnMock = mock((..._args: unknown[]) => {});
    console.warn = warnMock as unknown as typeof console.warn;
    try {
      const instance = new DiffRendererErrorBoundary({
        previous: {},
        current: {},
        windowType: "plan",
        windowId: "w_eb_3",
        children: null,
      });
      instance.state = { hasError: true, message: "x" };
      instance.componentDidCatch(new Error("boom"));
      expect(warnMock).toHaveBeenCalled();
      const firstArg = String((warnMock.mock.calls[0] ?? [])[0] ?? "");
      expect(firstArg).toContain("plan");
      expect(firstArg).toContain("w_eb_3");
    } finally {
      console.warn = origWarn;
    }
  });
});
