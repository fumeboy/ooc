/**
 * Context Compact 测试
 *
 * 覆盖：
 * - src/thinkable/context/compact.ts 的纯函数：estimateEventsTokens / applyMarks / applyCompact / buildCompactHint
 * - kernel/traits/compact/index.ts 的 llm_methods：list_actions / truncate_action / drop_action / close_trait / preview_compact
 * - context-builder 对 compact_summary 的渲染
 * - engine submit compact 分支（通过直接构造 threadData 验证）
 *
 * @ref docs/工程管理/迭代/all/20260422_feature_context_compact.md
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

import {
  estimateEventsTokens,
  applyMarks,
  applyCompact,
  buildCompactHint,
  previewCompactedTokens,
  COMPACT_THRESHOLD_TOKENS,
} from "../src/thinkable/context/compact";
import { ThreadsTree } from "../src/thinkable/thread-tree/tree";
import type { ProcessEvent, ThreadDataFile } from "../src/thinkable/thread-tree/types";
import { renderThreadProcess } from "../src/thinkable/context/builder";
import {
  llm_methods as compactMethods,
} from "../traits/compact/index";

const TEST_DIR = join(import.meta.dir, ".tmp_thread_compact_test");

beforeEach(() => mkdirSync(TEST_DIR, { recursive: true }));
afterEach(() => rmSync(TEST_DIR, { recursive: true, force: true }));

/* ========== 辅助 ========== */

/** 生成一条简单的 ProcessEvent */
function mkAction(partial: Partial<ProcessEvent> & { type: ProcessEvent["type"]; content: string }): ProcessEvent {
  return {
    timestamp: partial.timestamp ?? Date.now(),
    ...partial,
  } as ProcessEvent;
}

/* ========== compact.ts 纯函数 ========== */

describe("estimateEventsTokens", () => {
  test("空数组返回 0", () => {
    expect(estimateEventsTokens([])).toBe(0);
  });

  test("非空数组返回约为 JSON.stringify(len)/4 的整数", () => {
    const events: ProcessEvent[] = [
      mkAction({ type: "text", content: "a".repeat(400), timestamp: 1 }),
    ];
    const json = JSON.stringify(events);
    expect(estimateEventsTokens(events)).toBe(Math.floor(json.length / 4));
  });
});

describe("applyMarks", () => {
  test("drop 标记移除对应 event", () => {
    const events: ProcessEvent[] = [
      mkAction({ type: "text", content: "keep-0", timestamp: 1 }),
      mkAction({ type: "text", content: "drop-1", timestamp: 2 }),
      mkAction({ type: "text", content: "keep-2", timestamp: 3 }),
    ];
    const out = applyMarks(events, { drops: [{ idx: 1, reason: "x".repeat(20) }] });
    expect(out).toHaveLength(2);
    expect(out[0]!.content).toBe("keep-0");
    expect(out[1]!.content).toBe("keep-2");
  });

  test("truncate 标记截断 content", () => {
    const content = Array.from({ length: 50 }, (_, i) => `line-${i}`).join("\n");
    const events: ProcessEvent[] = [mkAction({ type: "program", content, timestamp: 1 })];
    const out = applyMarks(events, { truncates: [{ idx: 0, maxLines: 5 }] });
    expect(out).toHaveLength(1);
    const lines = out[0]!.content.split("\n");
    expect(lines[0]).toBe("line-0");
    expect(lines[4]).toBe("line-4");
    expect(lines[5]).toContain("共 50 行");
  });

  test("truncate 同时也会截断 result 字段", () => {
    const result = Array.from({ length: 20 }, (_, i) => `r-${i}`).join("\n");
    const events: ProcessEvent[] = [
      mkAction({ type: "program", content: "code()", result, timestamp: 1 }),
    ];
    const out = applyMarks(events, { truncates: [{ idx: 0, maxLines: 3 }] });
    expect(out[0]!.result!.split("\n")[0]).toBe("r-0");
    expect(out[0]!.result!).toContain("共 20 行");
  });

  test("drop 与 truncate 同 idx 时 drop 优先", () => {
    const events: ProcessEvent[] = [
      mkAction({ type: "text", content: "a\nb\nc\nd", timestamp: 1 }),
    ];
    const out = applyMarks(events, {
      drops: [{ idx: 0, reason: "x".repeat(20) }],
      truncates: [{ idx: 0, maxLines: 2 }],
    });
    expect(out).toHaveLength(0);
  });

  test("无标记时 events 原样返回", () => {
    const events: ProcessEvent[] = [
      mkAction({ type: "text", content: "only", timestamp: 1 }),
    ];
    const out = applyMarks(events, {});
    expect(out).toEqual(events);
  });
});

describe("applyCompact", () => {
  test("插入 compact_summary 作为首条，timestamp 最小", () => {
    const events: ProcessEvent[] = [
      mkAction({ type: "text", content: "one", timestamp: 100 }),
      mkAction({ type: "text", content: "two", timestamp: 200 }),
    ];
    const out = applyCompact(events, {}, "摘要文本");

    expect(out).toHaveLength(3);
    expect(out[0]!.type).toBe("compact_summary");
    expect(out[0]!.content).toBe("摘要文本");
    expect(out[0]!.timestamp).toBe(99); /* min ts - 1 */
    expect(out[0]!.original).toBe(2);
    expect(out[0]!.kept).toBe(2);
  });

  test("原 events 全空时 compact_summary 用当前时间", () => {
    const out = applyCompact([], {}, "空历史的摘要");
    expect(out).toHaveLength(1);
    expect(out[0]!.type).toBe("compact_summary");
    expect(out[0]!.original).toBe(0);
    expect(out[0]!.kept).toBe(0);
    /* 非 Infinity 兜底 */
    expect(Number.isFinite(out[0]!.timestamp)).toBe(true);
  });

  test("compactMarks 生效：drop + truncate 被应用", () => {
    const events: ProcessEvent[] = [
      mkAction({ type: "text", content: "keep", timestamp: 1 }),
      mkAction({ type: "text", content: "drop-me", timestamp: 2 }),
      mkAction({ type: "text", content: "a\nb\nc\nd\ne", timestamp: 3 }),
    ];
    const out = applyCompact(events, {
      drops: [{ idx: 1, reason: "x".repeat(25) }],
      truncates: [{ idx: 2, maxLines: 2 }],
    }, "压缩后");

    /* compact_summary + keep + 截断后的 a\nb */
    expect(out).toHaveLength(3);
    expect(out[0]!.type).toBe("compact_summary");
    expect(out[0]!.kept).toBe(2); /* 原 3 条 drop 1 条 = 2 */
    expect(out[1]!.content).toBe("keep");
    expect(out[2]!.content.split("\n")[0]).toBe("a");
    expect(out[2]!.content).toContain("共 5 行");
  });
});

describe("previewCompactedTokens", () => {
  test("应用标记后的 token 数小于原始", () => {
    const events: ProcessEvent[] = [
      mkAction({ type: "program", content: "x".repeat(4000), timestamp: 1 }),
      mkAction({ type: "text", content: "y".repeat(4000), timestamp: 2 }),
    ];
    const before = estimateEventsTokens(events);
    const after = previewCompactedTokens(events, {
      drops: [{ idx: 0, reason: "no longer needed, exploratory read result" }],
    });
    expect(after).toBeLessThan(before);
  });
});

describe("buildCompactHint", () => {
  test("包含提示关键字和 token 数", () => {
    const hint = buildCompactHint(65_000);
    expect(hint).toContain("compact");
    expect(hint).toContain("65k");
    expect(hint).toContain('open(command="compact")');
  });

  test("阈值常量存在", () => {
    expect(COMPACT_THRESHOLD_TOKENS).toBe(60_000);
  });
});

/* ========== context-builder 渲染 ========== */

describe("renderThreadProcess — compact_summary", () => {
  test("compact_summary 作为首条渲染，含 original/kept 属性", () => {
    const events: ProcessEvent[] = [
      mkAction({ type: "compact_summary", content: "此前的摘要", timestamp: 99, original: 42, kept: 8 }),
      mkAction({ type: "text", content: "之后的新内容", timestamp: 100 }),
    ];
    const rendered = renderThreadProcess(events);
    expect(rendered).toContain('type="compact_summary"');
    expect(rendered).toContain('original="42"');
    expect(rendered).toContain('kept="8"');
    expect(rendered).toContain("此前的摘要");
    /* compact_summary 在前 */
    expect(rendered.indexOf("此前的摘要")).toBeLessThan(rendered.indexOf("之后的新内容"));
  });
});

/* ========== compact trait llm_methods ========== */

describe("compact trait llm_methods", () => {
  async function setupTreeAndCtx() {
    const tree = await ThreadsTree.create(TEST_DIR, "root");
    const threadId = tree.rootId;
    const td = tree.readThreadData(threadId)!;
    td.events = [
      mkAction({ type: "text", content: "第 0 条 keep", timestamp: 10 }),
      mkAction({ type: "program", content: Array.from({ length: 50 }, (_, i) => `line-${i}`).join("\n"), result: "ok", timestamp: 20 }),
      mkAction({ type: "inject", content: "第 2 条", timestamp: 30 }),
    ];
    tree.writeThreadData(threadId, td);
    const ctx = { __threadId: threadId, __threadsTree: tree };
    return { tree, threadId, ctx };
  }

  test("list_actions 返回 idx + summary + lines，排除 compact_summary", async () => {
    const { tree, threadId, ctx } = await setupTreeAndCtx();
    /* 插入一条 compact_summary 验证被过滤 */
    const td = tree.readThreadData(threadId)!;
    td.events.unshift(mkAction({ type: "compact_summary", content: "旧摘要", timestamp: 1 }));
    tree.writeThreadData(threadId, td);

    const res = await compactMethods.list_actions!.fn(ctx);
    expect((res as any).ok).toBe(true);
    const data = (res as any).data;
    expect(data.total).toBe(3); /* compact_summary 被过滤 */
    /* 确认没有 compact_summary type */
    for (const item of data.items) {
      expect(item.type).not.toBe("compact_summary");
    }
    expect(data.estimatedTokens).toBeGreaterThan(0);
  });

  test("truncate_action 写入 compactMarks.truncates", async () => {
    const { tree, threadId, ctx } = await setupTreeAndCtx();
    const res = await compactMethods.truncate_action!.fn(ctx, { idx: 1, maxLines: 5 });
    expect((res as any).ok).toBe(true);

    const td = tree.readThreadData(threadId)!;
    expect(td.compactMarks?.truncates).toHaveLength(1);
    expect(td.compactMarks?.truncates![0]).toEqual({ idx: 1, maxLines: 5 });
  });

  test("truncate_action 同 idx 第二次调用覆盖", async () => {
    const { tree, threadId, ctx } = await setupTreeAndCtx();
    await compactMethods.truncate_action!.fn(ctx, { idx: 1, maxLines: 5 });
    await compactMethods.truncate_action!.fn(ctx, { idx: 1, maxLines: 20 });

    const td = tree.readThreadData(threadId)!;
    expect(td.compactMarks?.truncates).toHaveLength(1);
    expect(td.compactMarks?.truncates![0]!.maxLines).toBe(20);
  });

  test("drop_action 拒绝短 reason（<20 字）", async () => {
    const { ctx } = await setupTreeAndCtx();
    const res = await compactMethods.drop_action!.fn(ctx, { idx: 0, reason: "短" });
    expect((res as any).ok).toBe(false);
    expect((res as any).error).toContain("20 个字符");
  });

  test("drop_action 成功写入 compactMarks.drops", async () => {
    const { tree, threadId, ctx } = await setupTreeAndCtx();
    const longReason = "这是一条探索性读取产生的记录，结论已沉淀到 memory";
    expect(longReason.length).toBeGreaterThanOrEqual(20);
    const res = await compactMethods.drop_action!.fn(ctx, { idx: 1, reason: longReason });
    expect((res as any).ok).toBe(true);

    const td = tree.readThreadData(threadId)!;
    expect(td.compactMarks?.drops).toHaveLength(1);
    expect(td.compactMarks?.drops![0]!.idx).toBe(1);
  });

  test("drop_action 拒绝 compact_summary 类型", async () => {
    const { tree, threadId, ctx } = await setupTreeAndCtx();
    const td = tree.readThreadData(threadId)!;
    td.events.unshift(mkAction({ type: "compact_summary", content: "旧", timestamp: 1 }));
    tree.writeThreadData(threadId, td);

    const longReason = "不应该成功的丢弃请求，因为 compact_summary 是历史锚点不可移除";
    expect(longReason.length).toBeGreaterThanOrEqual(20);
    const res = await compactMethods.drop_action!.fn(ctx, { idx: 0, reason: longReason });
    expect((res as any).ok).toBe(false);
    expect((res as any).error).toContain("compact_summary");
  });

  test("preview_compact 预估效果", async () => {
    const { ctx } = await setupTreeAndCtx();
    /* 先标记 drop + truncate */
    const reason = "确认可以丢的原因说明——探索性读取结论已沉淀到 memory";
    expect(reason.length).toBeGreaterThanOrEqual(20);
    await compactMethods.drop_action!.fn(ctx, { idx: 2, reason });
    await compactMethods.truncate_action!.fn(ctx, { idx: 1, maxLines: 3 });

    const res = await compactMethods.preview_compact!.fn(ctx);
    expect((res as any).ok).toBe(true);
    const data = (res as any).data;
    expect(data.dropCount).toBe(1);
    expect(data.truncateCount).toBe(1);
    expect(data.after).toBeLessThan(data.before);
    expect(data.savedTokens).toBe(data.before - data.after);
  });

  test("close_trait 调用 tree.deactivateTrait", async () => {
    const { tree, threadId, ctx } = await setupTreeAndCtx();
    /* 先激活一个假 trait */
    await tree.activateTrait(threadId, "library:test/fake");
    await tree.pinTrait(threadId, "library:test/fake");

    const res = await compactMethods.close_trait!.fn(ctx, { traitId: "library:test/fake" });
    expect((res as any).ok).toBe(true);
    expect((res as any).data.changed).toBe(true);

    const node = tree.getNode(threadId)!;
    expect(node.activatedTraits ?? []).not.toContain("library:test/fake");
    expect(node.pinnedTraits ?? []).not.toContain("library:test/fake");
  });

  test("close_trait 拒绝不带 namespace 的 traitId", async () => {
    const { ctx } = await setupTreeAndCtx();
    const res = await compactMethods.close_trait!.fn(ctx, { traitId: "fake" });
    expect((res as any).ok).toBe(false);
    expect((res as any).error).toContain("namespace:name");
  });

  test("ctx 缺失 __threadId 时返回错误", async () => {
    const res = await compactMethods.list_actions!.fn({} as any);
    expect((res as any).ok).toBe(false);
    expect((res as any).error).toContain("compact trait");
  });
});

/* ========== 端到端：threadData + applyCompact 流程 ========== */

describe("end-to-end — compact 数据流", () => {
  test("list → truncate → drop → preview → applyCompact → 新 events", async () => {
    const tree = await ThreadsTree.create(TEST_DIR, "root");
    const threadId = tree.rootId;
    const td = tree.readThreadData(threadId)!;

    const longContent = Array.from({ length: 100 }, (_, i) => `line-${i}`).join("\n");
    td.events = [
      mkAction({ type: "text", content: "keep-0", timestamp: 100 }),
      mkAction({ type: "program", content: longContent, result: "ok", timestamp: 200 }),
      mkAction({ type: "text", content: "drop-me", timestamp: 300 }),
    ];
    tree.writeThreadData(threadId, td);

    const ctx = { __threadId: threadId, __threadsTree: tree };
    await compactMethods.truncate_action!.fn(ctx, { idx: 1, maxLines: 5 });
    await compactMethods.drop_action!.fn(ctx, { idx: 2, reason: "已经记到 memory 不必保留详细记录" });

    /* 预估 */
    const preview = await compactMethods.preview_compact!.fn(ctx);
    expect((preview as any).data.dropCount).toBe(1);
    expect((preview as any).data.truncateCount).toBe(1);

    /* 应用（engine 会做，这里手动调） */
    const tdNow = tree.readThreadData(threadId)!;
    const newEvents = applyCompact(tdNow.events, tdNow.compactMarks ?? {}, "本阶段完成 X，结论是 Y");

    /* 验证：compact_summary 首条 + keep-0 + 截断后的 program */
    expect(newEvents).toHaveLength(3);
    expect(newEvents[0]!.type).toBe("compact_summary");
    expect(newEvents[0]!.content).toContain("本阶段完成 X");
    expect(newEvents[0]!.original).toBe(3);
    expect(newEvents[0]!.kept).toBe(2); /* drop 了 1 条 */
    expect(newEvents[1]!.content).toBe("keep-0");
    expect(newEvents[2]!.type).toBe("program");
    expect(newEvents[2]!.content.split("\n")[0]).toBe("line-0");
    expect(newEvents[2]!.content).toContain("共 100 行");
  });
});
