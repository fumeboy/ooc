/**
 * LoopTimeline unit tests — R0c.
 *
 * 测试范围: 数据层 (partitionEventsByLoop) + event 分类 (classifyLoopEvent / isKeyEvent)。
 * Web 工程未安装 React Testing Library, 因此不做完整组件 DOM 渲染断言 — 同 LLMInputJsonViewer.test.ts
 * 风格, 只对外暴露的纯函数 + 组件契约 (props 形态 / 颜色 token / 提示语) 做断言。
 *
 * 覆盖 ≥4 用例 (plan §R0c-7):
 * 1. 正常加载: 3 loops + 8 events → events 被 partition 到 3 个 loop
 * 2. 退化模式: loops=[] + events=5 → partition 返回空 Map (主组件改走退化分支)
 * 3. 空状态: loops=[] + events=[] → partition 返回空 Map + 空 unassigned
 * 4. 关键 event 高亮: classifyLoopEvent 对 permission_ask + context_compressed
 *    返回各自的 color + tooltip 形态
 * 5. (额外) 非关键事件被过滤: 普通 text / reasoning / tool_use 不进 badge
 * 6. (额外) permission_ask 三态 (pending / approved / rejected) 颜色映射正确
 */

import { describe, expect, it } from "bun:test";
import { partitionEventsByLoop } from "./LoopTimeline";
import {
  classifyLoopEvent,
  isKeyEvent,
  type LoopEvent,
} from "./LoopEventBadge";
import type { LoopListEntry } from "./loop-types";

function loop(idx: number): LoopListEntry {
  return {
    loopIndex: idx,
    hasInput: true,
    hasOutput: true,
    hasMeta: true,
    meta: {
      threadId: "t",
      loopIndex: idx,
      startedAt: 1_700_000_000_000 + idx * 1000,
      finishedAt: 1_700_000_000_000 + idx * 1000 + 500,
      latencyMs: 500,
      messageCount: 5,
      toolCount: 3,
      toolCallCount: 1,
      contextBytes: 1234,
      resultTextBytes: 567,
      status: "ok",
    },
  };
}

describe("partitionEventsByLoop", () => {
  it("Case 1: 3 loops + 8 events → 每个 loop 至少分到 events (最后一个吃余数)", () => {
    const loops = [loop(1), loop(2), loop(3)];
    const events: LoopEvent[] = Array.from(
      { length: 8 },
      (_, i): LoopEvent => ({ category: "llm_interaction", kind: "text" } as unknown as LoopEvent),
    );
    const { perLoop, unassigned } = partitionEventsByLoop(loops, events);
    expect(perLoop.size).toBe(3);
    // 8 / 3 = 2 余 2 → loop1=2, loop2=2, loop3=4
    expect(perLoop.get(1)?.length).toBe(2);
    expect(perLoop.get(2)?.length).toBe(2);
    expect(perLoop.get(3)?.length).toBe(4);
    expect(unassigned).toEqual([]);
  });

  it("Case 2: 退化模式 — loops=[] + events=5 → perLoop 空, unassigned 空 (UI 改走退化分支)", () => {
    const events: LoopEvent[] = Array.from(
      { length: 5 },
      (): LoopEvent => ({ category: "llm_interaction", kind: "text" } as unknown as LoopEvent),
    );
    const { perLoop, unassigned } = partitionEventsByLoop([], events);
    expect(perLoop.size).toBe(0);
    expect(unassigned).toEqual([]);
  });

  it("Case 3: 空状态 — loops=[] + events=[] → 全空", () => {
    const { perLoop, unassigned } = partitionEventsByLoop([], []);
    expect(perLoop.size).toBe(0);
    expect(unassigned).toEqual([]);
  });

  it("Case 1b: events 数少于 loops 时 — 前 N 个 loop 拿到 0, 最后一个吃所有", () => {
    const loops = [loop(1), loop(2), loop(3), loop(4)];
    const events: LoopEvent[] = [
      { category: "llm_interaction", kind: "text" } as unknown as LoopEvent,
      { category: "llm_interaction", kind: "text" } as unknown as LoopEvent,
    ];
    const { perLoop } = partitionEventsByLoop(loops, events);
    // 2 / 4 = 0 余 2 → loop1..3 都拿到 0, loop4 拿到 2
    expect(perLoop.get(1)?.length).toBe(0);
    expect(perLoop.get(2)?.length).toBe(0);
    expect(perLoop.get(3)?.length).toBe(0);
    expect(perLoop.get(4)?.length).toBe(2);
  });
});

describe("classifyLoopEvent — type-dispatch 表", () => {
  it("Case 4a: permission_ask (无 decided) → yellow + 'awaiting approval' tooltip", () => {
    const evt: LoopEvent = {
      category: "permission",
      kind: "permission_ask",
      method: "write_file",
    };
    const spec = classifyLoopEvent(evt);
    expect(spec).toBeDefined();
    expect(spec?.color).toBe("yellow");
    expect(spec?.icon).toBe("⏸️");
    expect(spec?.tooltip).toContain("awaiting approval");
    expect(spec?.tooltip).toContain("write_file");
  });

  it("Case 4b: context_compressed (reason=user-compress) → blue + 'user-compress' tooltip", () => {
    const evt: LoopEvent = {
      category: "context_change",
      kind: "context_compressed",
      reason: "user-compress",
      windowIds: ["w_1", "w_2"],
    };
    const spec = classifyLoopEvent(evt);
    expect(spec).toBeDefined();
    expect(spec?.color).toBe("blue");
    expect(spec?.icon).toBe("🗜️");
    expect(spec?.tooltip).toContain("user-compress");
  });

  it("permission_ask (decided.approve) → green + 'approved' label", () => {
    const evt: LoopEvent = {
      category: "permission",
      kind: "permission_ask",
      method: "exec",
      decided: { action: "approve", at: Date.now() },
    };
    const spec = classifyLoopEvent(evt);
    expect(spec?.color).toBe("green");
    expect(spec?.label).toBe("approved");
  });

  it("permission_ask (decided.reject) → red + reason in tooltip", () => {
    const evt: LoopEvent = {
      category: "permission",
      kind: "permission_ask",
      method: "exec",
      decided: { action: "reject", at: Date.now(), reason: "out-of-policy" },
    };
    const spec = classifyLoopEvent(evt);
    expect(spec?.color).toBe("red");
    expect(spec?.tooltip).toContain("out-of-policy");
  });

  it("permission_denied → red + 'denied' label", () => {
    const evt: LoopEvent = {
      category: "permission",
      kind: "permission_denied",
      method: "exec",
      reason: "blocked",
    };
    const spec = classifyLoopEvent(evt);
    expect(spec?.color).toBe("red");
    expect(spec?.label).toBe("denied");
    expect(spec?.tooltip).toContain("blocked");
  });

  it("events_summary → purple + count+summary in tooltip", () => {
    const evt: LoopEvent = {
      category: "context_change",
      kind: "events_summary",
      count: 12,
      summary: "tool spam folded",
    };
    const spec = classifyLoopEvent(evt);
    expect(spec?.color).toBe("purple");
    expect(spec?.tooltip).toContain("12 events folded");
    expect(spec?.tooltip).toContain("tool spam folded");
  });

  it("tool_result ok=false → orange + 'fail' label", () => {
    const evt: LoopEvent = {
      category: "tool_runtime",
      kind: "function_call_output",
      toolName: "exec",
      ok: false,
    };
    const spec = classifyLoopEvent(evt);
    expect(spec?.color).toBe("orange");
    expect(spec?.label).toContain("fail");
  });

  it("context_compressed (idle-fold) → gray with 'idle-fold' label", () => {
    const evt: LoopEvent = {
      category: "context_change",
      kind: "context_compressed",
      reason: "idle-fold",
      windowIds: ["w_1"],
    };
    const spec = classifyLoopEvent(evt);
    expect(spec?.color).toBe("gray");
    expect(spec?.icon).toBe("🍂");
  });

  it("context_compressed (emergency-guard-*) → orange", () => {
    const evt: LoopEvent = {
      category: "context_change",
      kind: "context_compressed",
      reason: "emergency-guard-context-overflow",
      windowIds: [],
    };
    const spec = classifyLoopEvent(evt);
    expect(spec?.color).toBe("orange");
  });
});

describe("isKeyEvent — 噪音过滤", () => {
  it("Case 5: 普通 text / reasoning / tool_use 不进 badge", () => {
    const noise: LoopEvent[] = [
      { category: "llm_interaction", kind: "text" } as unknown as LoopEvent,
      { category: "llm_interaction", kind: "thinking" } as unknown as LoopEvent,
      { category: "llm_interaction", kind: "tool_use" } as unknown as LoopEvent,
      { category: "context_change", kind: "inject" } as unknown as LoopEvent,
      { category: "context_change", kind: "inbox_message_arrived" } as unknown as LoopEvent,
      // tool 调用成功也不进 badge
      {
        category: "tool_runtime",
        kind: "function_call_output",
        toolName: "exec",
        ok: true,
      } as unknown as LoopEvent,
    ];
    for (const evt of noise) {
      expect(isKeyEvent(evt)).toBe(false);
    }
  });

  it("关键事件全部命中 isKeyEvent", () => {
    const keys: LoopEvent[] = [
      { category: "context_change", kind: "context_compressed", reason: "user-compress" } as LoopEvent,
      { category: "context_change", kind: "events_summary", count: 1, summary: "x" } as LoopEvent,
      { category: "permission", kind: "permission_ask", method: "x" } as LoopEvent,
      { category: "permission", kind: "permission_denied", method: "x", reason: "y" } as LoopEvent,
      { category: "tool_runtime", kind: "function_call_output", toolName: "exec", ok: false } as LoopEvent,
    ];
    for (const evt of keys) {
      expect(isKeyEvent(evt)).toBe(true);
    }
  });
});

describe("R0c integration scenarios", () => {
  it("Case 4 (combined): thread.events 含 permission_ask + context_compressed → 在 timeline 中可被 partition + classify", () => {
    const loops = [loop(1)];
    const events: LoopEvent[] = [
      { category: "permission", kind: "permission_ask", method: "edit" } as LoopEvent,
      {
        category: "context_change",
        kind: "context_compressed",
        reason: "user-compress",
        windowIds: ["w_1"],
      } as LoopEvent,
      // noise event 应被 filter out (在 LoopTimeline 渲染时调 filter(isKeyEvent))
      { category: "llm_interaction", kind: "text" } as unknown as LoopEvent,
    ];
    const { perLoop } = partitionEventsByLoop(loops, events);
    const loop1Events = perLoop.get(1) ?? [];
    expect(loop1Events.length).toBe(3);
    const keyOnly = loop1Events.filter(isKeyEvent);
    expect(keyOnly.length).toBe(2);
    // 第一关键 event = yellow (pending permission ask)
    const spec1 = classifyLoopEvent(keyOnly[0]);
    expect(spec1?.color).toBe("yellow");
    // 第二关键 event = blue (user-compress)
    const spec2 = classifyLoopEvent(keyOnly[1]);
    expect(spec2?.color).toBe("blue");
  });
});
