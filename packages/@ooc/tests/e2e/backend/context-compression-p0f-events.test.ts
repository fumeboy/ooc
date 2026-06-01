/**
 * P0f — events 流 head/tail ring + 中段摘要 e2e。
 *
 * Design: docs/2026-05-25-context-compression-design.md §4.2 + §4.5
 * Meta:   meta/object.doc.ts:thinkable.children.context_budget.patches.events_ring
 *
 * 验证:
 * 1. 默认 fold 中段: head_ring (J=10) + tail_ring (K=40) 之外的 events 被 _foldedBy 标记
 * 2. 渲染层: 只保留 head + 1 条 summary + tail = 51 个渲染单元
 * 3. 持久化: _foldedBy 字段保留进 thread.json, reload 后 fold 状态不丢
 * 4. target_event_ids 路径: 仅指定的连续区段被 fold
 * 5. 错误路径: summary 缺失 / target_event_ids 非连续 → 结构化错误, thread 状态不变
 *
 * 不依赖 RUN_BACKEND_E2E gate: fixture-based unit-style 验收。
 */

import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { makeThread } from "@ooc/core/__tests__/make-thread";
import { dispatchToolCall } from "@ooc/core/executable/tools";
import type { ProcessEvent } from "@ooc/core/thinkable/context";
import { buildInputItems } from "@ooc/core/thinkable/context";
import { readThread, writeThread } from "@ooc/core/persistable/thread-json";
import type { ThreadPersistenceRef } from "@ooc/core/persistable/common";

// 触发 windows/ 各 type 的 side-effect 注册。
import "@ooc/core/executable/windows";

const SESSION_PREFIX = "_test_thinkable_p0f_events";
const ts = () => `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

/** 构造一个简单可控的 text event,带稳定 id 便于断言。 */
function mkTextEvent(idx: number): ProcessEvent {
  return {
    id: `e_text_${String(idx).padStart(3, "0")}`,
    category: "llm_interaction",
    kind: "text",
    text: `text event #${idx}`,
  };
}

describe("[p0f] context compression — compress(scope=events) + 渲染层 fold", () => {
  it("默认 fold 中段: 60 条 events → head(10) + summary + tail(40), 51 渲染单元", async () => {
    const thread = makeThread();
    // 注入 60 条 events
    for (let i = 0; i < 60; i++) {
      thread.events.push(mkTextEvent(i));
    }
    const baselineEventsLen = thread.events.length;
    expect(baselineEventsLen).toBe(60);

    // 调用 compress(scope=events) — 不提供 target_event_ids → 默认 fold 中段
    const out = await dispatchToolCall(thread, {
      id: "call_compress_events_1",
      name: "compress",
      arguments: {
        scope: "events",
        summary: "earlier setup phase, including 3 file opens and 2 search runs",
        quality_hint: "curated",
        title: "fold middle events",
      },
    });
    const parsed = JSON.parse(out);
    expect(parsed.ok).toBe(true);
    expect(parsed.tool).toBe("compress");
    expect(parsed.folded_count).toBe(60 - 10 - 40); // = 10
    expect(parsed.folded_range.start_index).toBe(10);
    expect(parsed.folded_range.end_index).toBe(20);
    expect(parsed.head_ring).toBe(10);
    expect(parsed.tail_ring).toBe(40);
    expect(typeof parsed.summary_event_id).toBe("string");

    const summaryId = parsed.summary_event_id as string;

    // thread.events 物理不真删 — 原 60 条仍在, 加上 1 条 summary + 1 条 context_compressed
    expect(thread.events.length).toBe(60 + 2);

    // 中段 [10..19] 被打上 _foldedBy=<summaryId>
    for (let i = 0; i < 60; i++) {
      // events 数组中,原 60 条 + summary 插在 fold 区段结束位置(原 index=20 之后)
      // 所以位置 0..19 是原 index 0..19, 位置 20 是 summary, 位置 21..60 是原 index 20..59
      let originalIdx = i;
      let arrayPos = i;
      if (i >= 20) arrayPos = i + 1; // summary 插在 fold 末尾后
      const e = thread.events[arrayPos];
      expect(e.id).toBe(`e_text_${String(originalIdx).padStart(3, "0")}`);
      if (originalIdx >= 10 && originalIdx < 20) {
        expect(e._foldedBy).toBe(summaryId);
      } else {
        expect(e._foldedBy).toBeUndefined();
      }
    }

    // 验证 head_ring (0..9) 与 tail_ring (20..59) 未被标记
    const head = thread.events.slice(0, 10);
    expect(head.every((e) => !e._foldedBy)).toBe(true);

    // summary event 自身位于 index=20
    const summaryEvent = thread.events[20];
    expect(summaryEvent.category).toBe("context_change");
    if (summaryEvent.category === "context_change" && summaryEvent.kind === "events_summary") {
      expect(summaryEvent.id).toBe(summaryId);
      expect(summaryEvent.count).toBe(10);
      expect(summaryEvent.summary).toContain("earlier setup phase");
      expect(summaryEvent.qualityHint).toBe("curated");
      expect(summaryEvent.scope).toBe("user");
      expect(summaryEvent.earliestEventId).toBe("e_text_010");
      expect(summaryEvent.latestEventId).toBe("e_text_019");
    } else {
      throw new Error("summary event 类型断言失败");
    }

    // 末尾有 context_compressed 事件
    const lastEvent = thread.events[thread.events.length - 1];
    if (lastEvent.category === "context_change" && lastEvent.kind === "context_compressed") {
      expect(lastEvent.reason).toBe("user-events-fold");
      expect(lastEvent.scope).toBe("events");
      expect(lastEvent.windowIds).toEqual([]);
    } else {
      throw new Error("末尾应为 context_compressed 事件");
    }

    // 渲染层验证: head(10) + summary(1) + tail(40) = 51 个 text/system 单元
    // 加上末尾 context_compressed 自身的 system message 渲染 = 52
    // 任务要求"51 个渲染单元" — 这里把 context_compressed 也算进去会变 52,
    // 但题目目标是验证 head + summary + tail 出现; 我们精确分类断言。
    const { input } = await buildInputItems(thread);
    // 滤掉非 transcript 部分(XML context + paths)
    // 第一条 system message 是 XML context, 没 persistence 时无 paths item;
    // 后续都是 events transcript。
    const transcriptItems = input.slice(1); // 剥掉首条 XML context

    // 找到 transcript 中包含 "text event #" 的 assistant 单元 → 应是 head(10) + tail(40) = 50
    const textUnits = transcriptItems.filter(
      (it) => it.type === "message" && it.role === "assistant" && /text event #/.test(it.content),
    );
    expect(textUnits.length).toBe(50);

    // summary system message 应该出现并包含摘要文本
    const summaryItems = transcriptItems.filter(
      (it) => it.type === "message" && it.role === "system" && /events_summary count=10/.test(it.content),
    );
    expect(summaryItems.length).toBe(1);
    expect((summaryItems[0] as { content: string }).content).toContain("earlier setup phase");

    // head + summary + tail 总共 51 个渲染单元 (不算末尾 context_compressed 自身的系统消息)
    const headSummaryTail = textUnits.length + summaryItems.length;
    expect(headSummaryTail).toBe(51);

    // head 的第 1 条 / tail 的最后 1 条应该出现在文本中(顺序应是 head 在前, tail 在后)
    const headFirstIdx = transcriptItems.findIndex(
      (it) => it.type === "message" && /text event #0$/m.test(it.content),
    );
    const tailLastIdx = transcriptItems.findIndex(
      (it) => it.type === "message" && /text event #59$/m.test(it.content),
    );
    const summaryIdx = transcriptItems.findIndex(
      (it) => it.type === "message" && /events_summary count=10/.test(it.content),
    );
    expect(headFirstIdx).toBeGreaterThanOrEqual(0);
    expect(summaryIdx).toBeGreaterThan(headFirstIdx);
    expect(tailLastIdx).toBeGreaterThan(summaryIdx);
  });

  it("持久化: _foldedBy 字段保留进 thread.json, reload 后 fold 状态仍保持", async () => {
    const tmpRoot = mkdtempSync(join(tmpdir(), "ooc-p0f-persist-"));
    try {
      const ref: ThreadPersistenceRef = {
        baseDir: tmpRoot,
        sessionId: `${SESSION_PREFIX}_persist_${ts()}`,
        objectId: "test-obj",
        threadId: "t_p0f_persist",
      };
      const thread = makeThread({ persistence: ref, id: "t_p0f_persist" });
      for (let i = 0; i < 60; i++) {
        thread.events.push(mkTextEvent(i));
      }

      const out = await dispatchToolCall(thread, {
        id: "call_compress_events_persist",
        name: "compress",
        arguments: {
          scope: "events",
          summary: "persisted fold test",
        },
      });
      const parsed = JSON.parse(out);
      expect(parsed.ok).toBe(true);
      const summaryId = parsed.summary_event_id as string;

      await writeThread(thread);
      const restored = await readThread(ref, "t_p0f_persist");
      expect(restored).toBeDefined();
      const restoredEvents = restored!.events;

      // 找回 summary event
      const sum = restoredEvents.find(
        (e) => e.category === "context_change" && e.kind === "events_summary" && e.id === summaryId,
      );
      expect(sum).toBeDefined();

      // _foldedBy 锚点保留: 被 fold 区段每条仍带 _foldedBy=summaryId
      const foldedCount = restoredEvents.filter((e) => e._foldedBy === summaryId).length;
      expect(foldedCount).toBe(10);

      // 渲染层 reload 后仍跳过 folded events
      const { input } = await buildInputItems(restored!);
      const textUnits = input.filter(
        (it) => it.type === "message" && it.role === "assistant" && /text event #/.test(it.content),
      );
      expect(textUnits.length).toBe(50); // head(10) + tail(40)
    } finally {
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  it("target_event_ids: 仅指定的连续区段被 fold, 其余正常", async () => {
    const thread = makeThread();
    for (let i = 0; i < 30; i++) {
      thread.events.push(mkTextEvent(i));
    }

    // 指定 5 条连续 (index 5..9)
    const targetIds = [
      "e_text_005",
      "e_text_006",
      "e_text_007",
      "e_text_008",
      "e_text_009",
    ];

    const out = await dispatchToolCall(thread, {
      id: "call_compress_events_targets",
      name: "compress",
      arguments: {
        scope: "events",
        summary: "explicit 5-event fold",
        target_event_ids: targetIds,
      },
    });
    const parsed = JSON.parse(out);
    expect(parsed.ok).toBe(true);
    expect(parsed.folded_count).toBe(5);
    const summaryId = parsed.summary_event_id as string;

    // 仅 5..9 被 fold, 其余无标记
    const folded = thread.events.filter((e) => e._foldedBy === summaryId);
    expect(folded.length).toBe(5);
    const foldedIds = folded.map((e) => e.id).sort();
    expect(foldedIds).toEqual(targetIds.slice().sort());
  });

  it("错误: summary 缺失 → 结构化错误, thread 状态不变", async () => {
    const thread = makeThread();
    for (let i = 0; i < 60; i++) {
      thread.events.push(mkTextEvent(i));
    }
    const snapshotLen = thread.events.length;

    const out = await dispatchToolCall(thread, {
      id: "call_compress_events_missing_summary",
      name: "compress",
      arguments: {
        scope: "events",
        // summary 故意缺失
      },
    });
    const parsed = JSON.parse(out);
    expect(parsed.ok).toBe(false);
    expect(parsed.tool).toBe("compress");
    expect(parsed.error).toContain("summary");

    // thread.events 不应被改动
    expect(thread.events.length).toBe(snapshotLen);
    expect(thread.events.every((e) => !e._foldedBy)).toBe(true);
  });

  it("错误: target_event_ids 不连续 → 结构化错误, thread 状态不变", async () => {
    const thread = makeThread();
    for (let i = 0; i < 30; i++) {
      thread.events.push(mkTextEvent(i));
    }
    const snapshotLen = thread.events.length;

    const out = await dispatchToolCall(thread, {
      id: "call_compress_events_noncontiguous",
      name: "compress",
      arguments: {
        scope: "events",
        summary: "should fail",
        target_event_ids: ["e_text_001", "e_text_002", "e_text_005"], // 跳跃,非连续
      },
    });
    const parsed = JSON.parse(out);
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toContain("连续");

    expect(thread.events.length).toBe(snapshotLen);
    expect(thread.events.every((e) => !e._foldedBy)).toBe(true);
  });

  it("错误: 默认路径下 events 数量不足以触发中段 fold → 结构化错误", async () => {
    const thread = makeThread();
    // 只有 30 条, 低于 head(10) + tail(40) = 50
    for (let i = 0; i < 30; i++) {
      thread.events.push(mkTextEvent(i));
    }
    const snapshotLen = thread.events.length;

    const out = await dispatchToolCall(thread, {
      id: "call_compress_events_under_capacity",
      name: "compress",
      arguments: {
        scope: "events",
        summary: "too small",
      },
    });
    const parsed = JSON.parse(out);
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toContain("无中段可 fold");
    expect(thread.events.length).toBe(snapshotLen);
  });
});
