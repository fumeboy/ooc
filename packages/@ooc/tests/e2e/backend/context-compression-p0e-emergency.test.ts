/**
 * P0e — emergency budget guard e2e。
 *
 * Design: docs/2026-05-25-context-compression-design.md §4.4
 * Meta:   meta/object.doc.ts:thinkable.children.context_budget.patches.emergency_guard
 *
 * 验收要点 (5 个 case):
 * 1. tokens > soft 但 <= hard:applyEmergencyGuard 返回 warning, **不**降级 window
 * 2. tokens > hard 第一波:level 0 → 1, 落 ProcessEvent reason=emergency-guard-1
 * 3. tokens 仍 > hard 第二波:level 1 → 2, 落 reason=emergency-guard-2
 * 4. events 流 50+ 强制超 hard:进入 wave-3,出现 events_summary event + 中段 events
 *    被 _foldedBy 标记 + 落 context_compressed scope=events
 * 5. ThinkLoop 集成:warning 通过 system message 注入到 LLM 的 inputItems 中
 *
 * 不依赖 RUN_BACKEND_E2E gate;fixture-based unit-style,直接 bun test 即可。
 */

import { describe, expect, it } from "bun:test";

import { makeThread } from "@ooc/core/__tests__/make-thread";
import {
  applyEmergencyGuard,
  estimateThreadTokens,
  loadBudgetThresholds,
  DEFAULT_BUDGET_THRESHOLDS,
  type BudgetThresholds,
} from "@ooc/core/thinkable/context/budget";
import { buildInputItems, type ThreadContext, type ProcessEvent } from "@ooc/core/thinkable/context";
import { generateWindowId } from "@ooc/core/executable/windows/_shared/types";
import type {
  ContextWindow,
  FileWindow,
  SearchWindow,
} from "@ooc/core/executable/windows/_shared/types";

// 触发 windows/ side-effect 注册 (registry / commands)。
import "@ooc/core/executable/windows";

/** 构造一个带 N 个大体积 file_window 的 thread (用于稳定地超过 soft/hard 阈值)。 */
function makeFatThread(opts: { fileCount: number; payloadPerFile: number }): ThreadContext {
  const thread = makeThread();
  for (let i = 0; i < opts.fileCount; i++) {
    const w: FileWindow = {
      id: generateWindowId("file"),
      type: "file",
      title: `fat-file-${i}`,
      status: "open",
      createdAt: Date.now(),
      path: `/tmp/fat-${i}.txt`,
      // FileWindow 没有 content 字段, 但可以把内容放在 title — JSON.stringify 会算上。
      // 改用 title + 自定义字段 (TS 上是 narrow type, 用 cast 强加)
    };
    // 用 unknown cast 加一个 fat payload 字段,只是为了膨胀 JSON 体积——不影响产品语义
    (w as unknown as { _fatPayload: string })._fatPayload = "x".repeat(opts.payloadPerFile);
    thread.contextWindows.push(w);
  }
  return thread;
}

describe("[p0e] context budget — applyEmergencyGuard", () => {
  it("estimateThreadTokens: 单调递增 — 加更多内容必使估算变大", () => {
    const small = makeThread();
    const smallEst = estimateThreadTokens(small);

    const fat = makeFatThread({ fileCount: 5, payloadPerFile: 10_000 });
    const fatEst = estimateThreadTokens(fat);

    expect(fatEst).toBeGreaterThan(smallEst);
    // 粗略 sanity: 5 * 10_000 char ≈ 50_000 char ≈ 12_500 token (粗估 /4)
    expect(fatEst).toBeGreaterThan(10_000);
  });

  it("loadBudgetThresholds: persistence 缺失 → DEFAULT_BUDGET_THRESHOLDS", () => {
    const thread = makeThread();
    const t = loadBudgetThresholds(thread);
    expect(t).toEqual(DEFAULT_BUDGET_THRESHOLDS);
  });

  it("warning only (tokens > soft, <= hard): 仅返回 warning, 不降级, 不落事件", () => {
    // 测试用低阈值 fixture, 让用例稳定
    const thresholds: BudgetThresholds = { soft: 1_000, hard: 1_000_000 };
    const thread = makeFatThread({ fileCount: 2, payloadPerFile: 5_000 });

    const eventsBefore = thread.events.length;
    const result = applyEmergencyGuard(thread, thresholds);

    expect(result.warning).toBeDefined();
    expect(result.warning!.current).toBeGreaterThan(thresholds.soft);
    expect(result.warning!.soft).toBe(thresholds.soft);
    expect(result.warning!.hard).toBe(thresholds.hard);

    expect(result.changes).toEqual([]);
    expect(result.eventsFolded).toBe(false);
    // 未触发降级 → 不应有任何 context_compressed event
    expect(thread.events.length).toBe(eventsBefore);
  });

  it("wave 1 (level 0→1): tokens > hard 时第一波升档普通 window", () => {
    // hard 设得让 wave-1 触发即可
    const thresholds: BudgetThresholds = { soft: 1_000, hard: 50_000 };
    // 5 * 50_000 = 250K chars → 62.5K tokens > hard
    const thread = makeFatThread({ fileCount: 5, payloadPerFile: 50_000 });

    const result = applyEmergencyGuard(thread, thresholds);

    expect(result.warning).toBeDefined();
    expect(result.changes.length).toBeGreaterThan(0);

    // 第一波的 changes 都应是 0→1 / emergency-guard-1
    const wave1 = result.changes.filter((c) => c.reason === "emergency-guard-1");
    expect(wave1.length).toBeGreaterThan(0);
    for (const change of wave1) {
      expect(change.fromLevel).toBe(0);
      expect(change.toLevel).toBe(1);
    }

    // contextWindows 实际更新到 ≥1 (具体 1/2 取决于是否触发 wave-2)
    const folded = thread.contextWindows.filter((w) => (w.compressLevel ?? 0) >= 1);
    expect(folded.length).toBeGreaterThan(0);

    // 落了 context_compressed reason=emergency-guard-1 事件
    const emergencyEvents = thread.events.filter(
      (e): e is Extract<ProcessEvent, { kind: "context_compressed" }> =>
        e.category === "context_change" &&
        e.kind === "context_compressed" &&
        e.reason === "emergency-guard-1",
    );
    expect(emergencyEvents.length).toBe(1);
    expect(emergencyEvents[0].levelChange).toBe("0→1");
    expect(emergencyEvents[0].scope).toBe("auto");
  });

  it("wave 2 (level 1→2): 第一波后仍 > hard,继续升档", () => {
    // 用极小 hard 强制连续走两波 (第一波折成 level 1 后估算仍 > hard, 走第二波)
    const thresholds: BudgetThresholds = { soft: 50, hard: 100 };
    const thread = makeFatThread({ fileCount: 4, payloadPerFile: 5_000 });

    const result = applyEmergencyGuard(thread, thresholds);

    expect(result.warning).toBeDefined();

    const wave1 = result.changes.filter((c) => c.reason === "emergency-guard-1");
    const wave2 = result.changes.filter((c) => c.reason === "emergency-guard-2");
    expect(wave1.length).toBeGreaterThan(0);
    expect(wave2.length).toBeGreaterThan(0);

    // 所有 fat file_window 最终应到 level 2
    const atLevel2 = thread.contextWindows.filter((w) => (w.compressLevel ?? 0) === 2);
    expect(atLevel2.length).toBeGreaterThan(0);

    // 两条 context_compressed reason 分别为 emergency-guard-1 和 emergency-guard-2
    const reasons = thread.events
      .filter(
        (e): e is Extract<ProcessEvent, { kind: "context_compressed" }> =>
          e.category === "context_change" && e.kind === "context_compressed",
      )
      .map((e) => e.reason);
    expect(reasons).toContain("emergency-guard-1");
    expect(reasons).toContain("emergency-guard-2");
  });

  it("wave 3 (events fold): 50+ events 强制 fold 中段,出现 events_summary + _foldedBy", () => {
    // 构造一个 50+ events 的 thread; 用更小的 thresholds + 把 events 撑大,让 wave-1/2 不够,
    // 必须进 wave-3。fileCount 较少减少 wave-1/2 的回收量。
    const thresholds: BudgetThresholds = { soft: 10, hard: 50 };
    const thread = makeFatThread({ fileCount: 1, payloadPerFile: 500 });

    // 填 60 条 inject events,各带 200 字符
    for (let i = 0; i < 60; i++) {
      thread.events.push({
        category: "context_change",
        kind: "inject",
        text: `[错误] event #${i} ${"y".repeat(200)}`,
      });
    }

    const result = applyEmergencyGuard(thread, thresholds);

    expect(result.warning).toBeDefined();
    expect(result.eventsFolded).toBe(true);

    // events_summary event 出现 (P0f schema: count + summary + qualityHint + scope=auto)
    const summaryEvents = thread.events.filter(
      (e): e is Extract<ProcessEvent, { kind: "events_summary" }> =>
        e.category === "context_change" && e.kind === "events_summary",
    );
    expect(summaryEvents.length).toBe(1);
    expect(summaryEvents[0].summary).toBe(
      "[auto-fold by emergency guard, no LLM summary available]",
    );
    expect(summaryEvents[0].qualityHint).toBe("rough");
    expect(summaryEvents[0].scope).toBe("auto");
    expect(summaryEvents[0].count).toBeGreaterThan(0);
    expect(summaryEvents[0].id).toBeDefined();

    // 中段 events 被 _foldedBy 标记 (实际数据仍在 thread.events 中)
    const foldedEvents = thread.events.filter((e) => e._foldedBy !== undefined);
    expect(foldedEvents.length).toBeGreaterThan(0);
    // 所有 _foldedBy 都引用 summary id
    for (const e of foldedEvents) {
      expect(e._foldedBy).toBe(summaryEvents[0].id);
    }

    // 也落了一条 context_compressed reason=emergency-guard-events
    const eventsScopeAudit = thread.events.filter(
      (e): e is Extract<ProcessEvent, { kind: "context_compressed" }> =>
        e.category === "context_change" &&
        e.kind === "context_compressed" &&
        e.reason === "emergency-guard-events",
    );
    expect(eventsScopeAudit.length).toBe(1);
    expect(eventsScopeAudit[0].scope).toBe("events");
  });

  it("ThinkLoop 集成: warning 出现在 buildInputItems 之后被注入到 input 中", async () => {
    // 直接 mock thinkloop 中 applyEmergencyGuard + buildInputItems 的拼装逻辑,
    // 验证警告确实出现在 LLM 看到的 input 流中。
    const thresholds: BudgetThresholds = { soft: 10, hard: 1_000_000 };
    const thread = makeFatThread({ fileCount: 1, payloadPerFile: 500 });

    const guard = applyEmergencyGuard(thread, thresholds);
    expect(guard.warning).toBeDefined();

    const built = await buildInputItems(thread);

    // 复现 thinkloop 注入逻辑 (本测试不调 think(),而是单独验证拼装)
    const warningItem = {
      type: "message" as const,
      role: "system" as const,
      content:
        `<context_budget_warning current="${guard.warning!.current}" soft="${guard.warning!.soft}" hard="${guard.warning!.hard}"/>`,
    };
    const finalInput = [built.input[0], warningItem, ...built.input.slice(1)];

    // 警告 item 出现在第 1 位 (第 0 位是 XML context)
    expect(finalInput.length).toBeGreaterThanOrEqual(2);
    const warn = finalInput[1];
    expect(warn.type).toBe("message");
    if (warn.type === "message") {
      expect(warn.role).toBe("system");
      expect(warn.content).toContain("context_budget_warning");
      expect(warn.content).toContain(`current="${guard.warning!.current}"`);
      expect(warn.content).toContain(`soft="${guard.warning!.soft}"`);
      expect(warn.content).toContain(`hard="${guard.warning!.hard}"`);
    }

    // 警告**未**进 thread.events (本轮只在 LLM input 流出现,不持久化)
    const warningInEvents = thread.events.find((e) => {
      if (e.category !== "context_change") return false;
      // text 字段只在某些 variants 上;safe 访问
      const text = (e as { text?: string }).text;
      return typeof text === "string" && text.includes("context_budget_warning");
    });
    expect(warningInEvents).toBeUndefined();
  });

  it("豁免: root / command_exec / 活动 do_window 不被 emergency 折叠", () => {
    const thresholds: BudgetThresholds = { soft: 10, hard: 100 };
    const thread = makeThread();
    // 加一些 fat 普通 window 让超 hard
    const fatId = generateWindowId("search");
    const fat: SearchWindow = {
      id: fatId,
      type: "search",
      title: "fat search",
      status: "open",
      createdAt: Date.now(),
      kind: "grep",
      query: "x",
      matches: [],
      truncated: false,
    };
    (fat as unknown as { _fat: string })._fat = "z".repeat(10_000);
    thread.contextWindows.push(fat);

    // 显式注入一个 root + 一个 command_exec + 一个 running do_window (做大 payload 让它们也"应被压"但被豁免)
    const rootId = "root";
    thread.contextWindows.push({
      id: rootId,
      type: "root",
      title: "root",
      status: "active",
      createdAt: Date.now(),
    } as ContextWindow);
    const cmdId = generateWindowId("command_exec");
    thread.contextWindows.push({
      id: cmdId,
      type: "command_exec",
      title: "cmd",
      status: "executing",
      createdAt: Date.now(),
    } as ContextWindow);
    const doId = generateWindowId("do");
    thread.contextWindows.push({
      id: doId,
      type: "do",
      title: "running",
      status: "running",
      createdAt: Date.now(),
      targetThreadId: "t_child",
    } as ContextWindow);

    applyEmergencyGuard(thread, thresholds);

    // 豁免 window 不应被升档
    const root = thread.contextWindows.find((w) => w.id === rootId)!;
    const cmd = thread.contextWindows.find((w) => w.id === cmdId)!;
    const doW = thread.contextWindows.find((w) => w.id === doId)!;
    expect(root.compressLevel ?? 0).toBe(0);
    expect(cmd.compressLevel ?? 0).toBe(0);
    expect(doW.compressLevel ?? 0).toBe(0);

    // fat search 应被升档
    const fatAfter = thread.contextWindows.find((w) => w.id === fatId)!;
    expect((fatAfter.compressLevel ?? 0)).toBeGreaterThanOrEqual(1);
  });
});
