/**
 * ProgressIndicator 颜色逻辑单元测试
 *
 * 测试 getProgressColor 的阈值计算。
 * 由于 getProgressColor 是组件内部函数，这里提取逻辑进行测试。
 */
import { describe, test, expect } from "bun:test";

/** 复制自 ProgressIndicator.tsx 的颜色逻辑 */
function getProgressColor(ratio: number): string {
  if (ratio > 0.8) return "bg-red-500";
  if (ratio > 0.6) return "bg-amber-500";
  return "bg-[var(--primary)]";
}

function computeRatio(iterations: number, max: number, total: number, totalMax: number): number {
  return Math.max(iterations / max, total / totalMax);
}

describe("ProgressIndicator color logic", () => {
  test("< 60% returns neutral (primary)", () => {
    const ratio = computeRatio(30, 100, 30, 200);
    expect(getProgressColor(ratio)).toBe("bg-[var(--primary)]");
  });

  test("60-80% returns amber", () => {
    const ratio = computeRatio(70, 100, 70, 200);
    expect(getProgressColor(ratio)).toBe("bg-amber-500");
  });

  test("> 80% returns red", () => {
    const ratio = computeRatio(85, 100, 85, 200);
    expect(getProgressColor(ratio)).toBe("bg-red-500");
  });

  test("uses Math.max — global ratio dominates when higher", () => {
    // Flow at 30% but global at 90%
    const ratio = computeRatio(30, 100, 180, 200);
    expect(ratio).toBe(0.9);
    expect(getProgressColor(ratio)).toBe("bg-red-500");
  });

  test("uses Math.max — flow ratio dominates when higher", () => {
    // Flow at 90% but global at 50%
    const ratio = computeRatio(90, 100, 100, 200);
    expect(ratio).toBe(0.9);
    expect(getProgressColor(ratio)).toBe("bg-red-500");
  });

  test("boundary: exactly 60% returns neutral", () => {
    const ratio = computeRatio(60, 100, 60, 200);
    expect(getProgressColor(ratio)).toBe("bg-[var(--primary)]");
  });

  test("boundary: exactly 80% returns amber", () => {
    const ratio = computeRatio(80, 100, 80, 200);
    expect(getProgressColor(ratio)).toBe("bg-amber-500");
  });
});
