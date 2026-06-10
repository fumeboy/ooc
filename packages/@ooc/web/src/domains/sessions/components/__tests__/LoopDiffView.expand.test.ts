/**
 * LoopDiffView.expand.test — Round 14 H1 防回归。
 *
 * 体验官 Round 14 报告抓到的 critical bug: LoopDiffView.tsx useEffect 把 detailsLoading
 * 既写又放在 deps array → effect 自触发自己的 cleanup (cancelled=true) → finally 内
 * setDetailsLoading(false) 不执行 → 非 file 类型 row 展开后永远显示 "Loading…"。
 *
 * Round 10 的 *.test.ts mock fetch 同步返回掩盖了 self-cancel 行为；本 test 必须
 * **真异步** (await Promise.resolve / microtask flush) 才能复现 + 防回归。
 *
 * 覆盖策略：
 *   1. 直接单测抽出的纯 helper fetchLoopInputsForDiff (主要防回归窗口) —— 用真异步
 *      Promise + 注入 fetcher mock，断言：
 *      a) needsCurrent + needsPrevious → fetch 调 2 次 + result 含 current/previous
 *      b) needsCurrent only → 只调 1 次
 *      c) currentLoopIndex=0 时 needsPrevious 忽略 (没有前一 loop)
 *      d) previous fetcher reject → 不传染 current；result.current 仍可拿到
 *      e) current fetcher reject → rethrow，调用方能 setDetailsError
 *   2. file_window 短路逻辑 (renderDetail 内的 entry.class==='file' + fileDiff 分支)
 *      通过 grep-style 静态断言: LoopDiffView 源码含 `if (entry.class === "file")`
 *      + `if (cur?.fileDiff) return;` — 保证 file 路径不进 fetch effect。
 *
 * 不覆盖（受限于无 DOM / 无 RTL）：
 *   - 完整 LoopDiffView 组件 mount + 点击 + DOM 断言 → 已交给 Playwright e2e
 *     (体验官报告建议 #1 列入 e2e 场景)。本单测只兜底 useEffect 内核逻辑。
 */

import { describe, expect, it } from "bun:test";
import { fetchLoopInputsForDiff } from "../LoopDiffView";

describe("Round 14 H1 — fetchLoopInputsForDiff 真异步覆盖", () => {
  it("Case 1: needsCurrent + needsPrevious → 调 fetcher 2 次，result 同时含 current/previous", async () => {
    const calls: number[] = [];
    const fetchLoop = async (loopIdx: number): Promise<unknown> => {
      calls.push(loopIdx);
      // 真异步: 让出 microtask 一次，确保 await 路径真跑
      await Promise.resolve();
      return { loopIdx, marker: `input-${loopIdx}` };
    };
    const res = await fetchLoopInputsForDiff({
      fetchLoop,
      currentLoopIndex: 5,
      needsCurrent: true,
      needsPrevious: true,
    });
    expect(calls.sort()).toEqual([4, 5]);
    expect((res.current as { marker: string }).marker).toBe("input-5");
    expect((res.previous as { marker: string }).marker).toBe("input-4");
  });

  it("Case 2: needsCurrent only → 只调 1 次 fetcher", async () => {
    const calls: number[] = [];
    const fetchLoop = async (loopIdx: number): Promise<unknown> => {
      calls.push(loopIdx);
      await Promise.resolve();
      return { marker: `input-${loopIdx}` };
    };
    const res = await fetchLoopInputsForDiff({
      fetchLoop,
      currentLoopIndex: 3,
      needsCurrent: true,
      needsPrevious: false,
    });
    expect(calls).toEqual([3]);
    expect(res.current).toBeDefined();
    expect(res.previous).toBeUndefined();
  });

  it("Case 3: currentLoopIndex=0 + needsPrevious=true → previous fetch 被跳过 (no loop -1)", async () => {
    const calls: number[] = [];
    const fetchLoop = async (loopIdx: number): Promise<unknown> => {
      calls.push(loopIdx);
      await Promise.resolve();
      return { marker: `input-${loopIdx}` };
    };
    const res = await fetchLoopInputsForDiff({
      fetchLoop,
      currentLoopIndex: 0,
      needsCurrent: true,
      needsPrevious: true,
    });
    expect(calls).toEqual([0]);
    expect(res.previous).toBeUndefined();
  });

  it("Case 4: previous fetcher reject → 不传染 current (warn 走), result.current 完整", async () => {
    const fetchLoop = async (loopIdx: number): Promise<unknown> => {
      await Promise.resolve();
      if (loopIdx === 4) throw new Error("loop 4 not exist");
      return { marker: `input-${loopIdx}` };
    };
    // 临时屏蔽 console.warn 避免 test 输出噪声
    const origWarn = console.warn;
    console.warn = () => {};
    try {
      const res = await fetchLoopInputsForDiff({
        fetchLoop,
        currentLoopIndex: 5,
        needsCurrent: true,
        needsPrevious: true,
      });
      expect((res.current as { marker: string }).marker).toBe("input-5");
      expect(res.previous).toBeUndefined();
    } finally {
      console.warn = origWarn;
    }
  });

  it("Case 5: current fetcher reject → rethrow, 调用方能拿到 error (不 silent-swallow)", async () => {
    const fetchLoop = async (loopIdx: number): Promise<unknown> => {
      await Promise.resolve();
      throw new Error(`loop ${loopIdx} backend 500`);
    };
    let caught: unknown;
    try {
      await fetchLoopInputsForDiff({
        fetchLoop,
        currentLoopIndex: 7,
        needsCurrent: true,
        needsPrevious: false,
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toContain("backend 500");
  });

  it("Case 6: 关键防回归 — fetcher 真异步多 microtask + 多次循环不会卡死 / 不会丢 result", async () => {
    // 模拟 R10 单测 mock 同步返回的对照: 这里强制 fetcher await 多次。
    // 如果 effect 重入或者 self-cancel 又 introduced, helper 一旦被串行调用会暴露顺序问题。
    const fetchLoop = async (loopIdx: number): Promise<unknown> => {
      await Promise.resolve();
      await Promise.resolve();
      await new Promise<void>((r) => setTimeout(r, 0));
      return { loopIdx };
    };

    // 串行调 3 次（模拟 LoopDiffView 在不同 loop / 不同 expand 多次触发）
    const r1 = await fetchLoopInputsForDiff({
      fetchLoop,
      currentLoopIndex: 1,
      needsCurrent: true,
      needsPrevious: false,
    });
    const r2 = await fetchLoopInputsForDiff({
      fetchLoop,
      currentLoopIndex: 2,
      needsCurrent: true,
      needsPrevious: true,
    });
    const r3 = await fetchLoopInputsForDiff({
      fetchLoop,
      currentLoopIndex: 3,
      needsCurrent: false,
      needsPrevious: true,
    });
    expect((r1.current as { loopIdx: number }).loopIdx).toBe(1);
    expect((r2.current as { loopIdx: number }).loopIdx).toBe(2);
    expect((r2.previous as { loopIdx: number }).loopIdx).toBe(1);
    expect((r3.previous as { loopIdx: number }).loopIdx).toBe(2);
    expect(r3.current).toBeUndefined();
  });
});

describe("Round 14 H1 — file_window 短路保护 (静态源码断言)", () => {
  it("Case 7: LoopDiffView 源码保留 file_window fileDiff 短路分支 (不走 fetch effect)", async () => {
    // 用静态 import 加载源码 (bun 支持 .text 风格)；这里改用 fs 读
    const fs = await import("node:fs");
    const path = new URL("../LoopDiffView.tsx", import.meta.url).pathname;
    const src = fs.readFileSync(path, "utf8");
    // 关键短路: file_window 有 fileDiff 时直接 return, 不进 fetchLoopInputsForDiff
    expect(src).toContain('if (entry.class === "file")');
    expect(src).toContain("if (cur?.fileDiff) return;");
    // 关键防回归: deps array 必须不含 detailsLoading (否则 self-cancel bug 重现)
    // 抓 effect 的 deps array 段
    const effectDepsMatch = src.match(
      /\}, \[\s*expandedId,\s*entryByIdMemo,\s*fetchLoopInput,\s*currentLoopIndex,([\s\S]*?)\]\);/,
    );
    expect(effectDepsMatch).not.toBeNull();
    if (effectDepsMatch) {
      const depsBody = effectDepsMatch[1];
      // 不能含 detailsLoading (这是 Round 14 H1 修复的核心) — 否则 self-cancel 回归
      expect(depsBody.includes("detailsLoading")).toBe(false);
    }
    // 必须用 inFlightRef 替代防重入 (语义更明确)
    expect(src).toContain("inFlightRef");
  });
});
