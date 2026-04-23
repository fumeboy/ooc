/**
 * Phase 5 防循环测试
 *
 * 覆盖：
 * - 同一 (path, error) 连续失败 N 次 → feedback.repeatCount 递增
 * - 达到阈值（REPEAT_FAIL_THRESHOLD=3）时 formatFeedbackForContext 追加告警
 * - path 修好（所有 hook pass）后计数清零，下轮失败从 1 重新开始
 * - 不同 errorHash（即错误文本变化）不累计
 * - 不同 threadId 互不干扰
 */

import { describe, test, expect, beforeEach } from "bun:test";
import {
  __clearHooks,
  registerBuildHook,
  runBuildHooks,
  getBuildFeedback,
  formatFeedbackForContext,
  getRepeatFailThreshold,
} from "../src/world/hooks";

beforeEach(() => {
  __clearHooks();
});

describe("repeatCount 递增", () => {
  test("同一 (path, error) 连续失败 3 次 → repeatCount=1/2/3", async () => {
    registerBuildHook({
      name: "f",
      match: () => true,
      run: async () => ({ success: false, output: "stable", errors: ["err-1"] }),
    });
    const threadId = "t_rep_1";
    const counts: number[] = [];
    for (let i = 0; i < 3; i++) {
      const produced = await runBuildHooks(["a.ts"], { rootDir: "/tmp", threadId });
      counts.push(produced[0]!.repeatCount ?? 0);
    }
    expect(counts).toEqual([1, 2, 3]);
  });

  test("修好一次 → 清零；下次失败重新从 1 开始", async () => {
    let ok = false;
    registerBuildHook({
      name: "f",
      match: () => true,
      run: async () => ok
        ? { success: true, output: "" }
        : { success: false, output: "stable", errors: ["err"] },
    });
    const threadId = "t_rep_2";
    const first = await runBuildHooks(["x.ts"], { rootDir: "/tmp", threadId });
    expect(first[0]!.repeatCount).toBe(1);
    const second = await runBuildHooks(["x.ts"], { rootDir: "/tmp", threadId });
    expect(second[0]!.repeatCount).toBe(2);
    ok = true;
    await runBuildHooks(["x.ts"], { rootDir: "/tmp", threadId });
    ok = false;
    const rebegin = await runBuildHooks(["x.ts"], { rootDir: "/tmp", threadId });
    expect(rebegin[0]!.repeatCount).toBe(1);
  });

  test("不同 error 文本不累加到同一 key", async () => {
    let ticks = 0;
    registerBuildHook({
      name: "f",
      match: () => true,
      run: async () => {
        ticks++;
        return { success: false, output: `run-${ticks}`, errors: [`err-${ticks}`] };
      },
    });
    const threadId = "t_rep_3";
    const r1 = await runBuildHooks(["y.ts"], { rootDir: "/tmp", threadId });
    const r2 = await runBuildHooks(["y.ts"], { rootDir: "/tmp", threadId });
    expect(r1[0]!.repeatCount).toBe(1);
    expect(r2[0]!.repeatCount).toBe(1); /* 不同错误文本 → 独立 key */
  });

  test("不同 threadId 计数互不干扰", async () => {
    registerBuildHook({
      name: "f",
      match: () => true,
      run: async () => ({ success: false, output: "s", errors: ["e"] }),
    });
    await runBuildHooks(["z.ts"], { rootDir: "/tmp", threadId: "tA" });
    await runBuildHooks(["z.ts"], { rootDir: "/tmp", threadId: "tA" });
    const tb = await runBuildHooks(["z.ts"], { rootDir: "/tmp", threadId: "tB" });
    expect(tb[0]!.repeatCount).toBe(1);
  });
});

describe("formatFeedbackForContext 告警", () => {
  test("repeatCount < 阈值不注入告警", async () => {
    registerBuildHook({
      name: "f",
      match: () => true,
      run: async () => ({ success: false, output: "s", errors: ["e"] }),
    });
    const threadId = "t_fmt_1";
    await runBuildHooks(["a.ts"], { rootDir: "/tmp", threadId });
    const out = formatFeedbackForContext(getBuildFeedback(threadId));
    expect(out).not.toContain("已重复失败");
  });

  test("repeatCount >= 阈值注入全局告警 + 条目级标签", async () => {
    registerBuildHook({
      name: "f",
      match: () => true,
      run: async () => ({ success: false, output: "s", errors: ["e"] }),
    });
    const threshold = getRepeatFailThreshold();
    expect(threshold).toBe(3);
    const threadId = "t_fmt_2";
    for (let i = 0; i < threshold; i++) {
      await runBuildHooks(["b.ts"], { rootDir: "/tmp", threadId });
    }
    const fb = getBuildFeedback(threadId);
    expect(fb.length).toBe(1);
    expect(fb[0]!.repeatCount).toBe(threshold);

    const out = formatFeedbackForContext(fb);
    /* 全局头部告警段 */
    expect(out).toContain("请停下来换思路");
    expect(out).toContain(`已重复失败 ${threshold} 次`);
    /* 条目级 ⚠️ 标签 */
    expect(out).toMatch(/##.*⚠️ 已重复失败/);
  });
});
