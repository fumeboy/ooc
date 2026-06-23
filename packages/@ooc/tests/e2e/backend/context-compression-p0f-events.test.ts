/**
 * compress v2 载体 —— 跨 job（scheduler_yielded → reload）折叠态持久化 e2e gate。
 *
 * 验证 compress v2 的两类载体收敛后挂**自己视角 thread 窗**（class=THREAD_CLASS_ID，inline 持久化）、
 * 跨 reload 不丢——与「折叠态怎么产生」（fork-summarizer + harvest）解耦（后者由 compress-v2.test.ts
 * 确定性 harvest + real-compress-v2.test.ts 真 LLM 全链覆盖）：
 *   1. `win.summarizedRanges`（已成段的折叠）：直写载体 → writeThread → readThread（模拟 job 切片
 *      scheduler_yielded → reload）→ 跨 reload 存活 → buildInputItems 投影仍折叠（assistant 文本数降 +
 *      events_summary 出现）。含 **self-driven root**（空 creator 通道的 thread 窗）用例。
 *   2. `win.inFlightCompress`（在途 summarizer fork 标记）：直写载体 → reload → 标记存活
 *      （reload 后 harvest 仍能找回 fork、force-wait 仍生效）。
 *
 * 折叠态挂 THREAD_CLASS_ID inline 整窗落 thread-context.json、builtin 类 hydrate 恒注册。
 * fixture-based、零真 LLM、可进 CI。
 */

import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { makeThread } from "@ooc/core/__tests__/make-thread";
import type { ProcessEvent } from "@ooc/core/_shared/types/thread.js";
import { buildInputItems } from "@ooc/builtins/agent/thread/thinkable/context/index";
import { createFlowObject } from "@ooc/core/persistable";
import { readThread, writeThread } from "@ooc/builtins/agent/thread/persistable/thread-json";
import {
  threadWindowIdOf,
  ROOT_WINDOW_ID,
  type ContextWindow,
} from "@ooc/core/_shared/types/context-window.js";
import { THREAD_CLASS_ID } from "@ooc/core/_shared/types/constants.js";
import type { ThreadPersistenceRef } from "@ooc/core/persistable/common";

// 触发 builtin class 注册（hydrate 用 builtinRegistry.has + isInlinePersisted 判定保留）。
import "@ooc/core/runtime/register-builtins.js";

const SESSION_PREFIX = "_test_compress_v2";

function mkTextEvent(idx: number): ProcessEvent {
  return {
    id: `e_text_${String(idx).padStart(3, "0")}`,
    category: "llm_interaction",
    kind: "text",
    text: `text event #${idx}`,
  };
}

type Items = Awaited<ReturnType<typeof buildInputItems>>["input"];
function assistantTextCount(input: Items): number {
  return input.filter(
    (i) => i.type === "message" && i.role === "assistant" && /text event #/.test((i as { content: string }).content),
  ).length;
}
function hasEventsSummary(input: Items): boolean {
  return input.some(
    (i) => i.type === "message" && i.role === "system" && /events_summary/.test((i as { content: string }).content),
  );
}

/**
 * 直接在 thread 窗 win 写折叠态（= compress v2 中 fork-summarizer + harvest 的产物）。
 * 本 gate 验**载体跨 job reload 持久化**，与「折叠态怎么产生」（fork/harvest）解耦——后者由
 * compress-v2.test.ts（确定性 harvest）+ real-compress-v2.test.ts（真 LLM 全链）覆盖。
 */
function foldDirectly(
  thread: { contextWindows?: ContextWindow[] },
  threadWinId: string,
  range: { fromIdx: number; toIdx: number; summary: string },
): void {
  const w = thread.contextWindows?.find((x) => x.id === threadWinId);
  if (w) {
    const win = ((w as { win?: unknown }).win ?? ((w as { win?: unknown }).win = {})) as {
      summarizedRanges?: unknown[];
    };
    win.summarizedRanges = [range];
  }
}

function summarizedRangesOf(thread: { contextWindows?: ContextWindow[] }, id: string): unknown[] {
  const win = thread.contextWindows?.find((w) => w.id === id)?.win as { summarizedRanges?: unknown[] } | undefined;
  return win?.summarizedRanges ?? [];
}

function inFlightOf(thread: { contextWindows?: ContextWindow[] }, id: string): unknown {
  const win = thread.contextWindows?.find((w) => w.id === id)?.win as { inFlightCompress?: unknown } | undefined;
  return win?.inFlightCompress;
}

describe("[caseA] events 折叠跨 job（scheduler_yielded → reload）持久化", () => {
  let baseDir: string;

  beforeEach(async () => {
    baseDir = await mkdtemp(join(tmpdir(), `${SESSION_PREFIX}-`));
  });
  afterEach(async () => {
    await rm(baseDir, { recursive: true, force: true });
  });

  it("有 creator 的 thread：compress(scope=events) 写 thread 窗 win → reload 折叠不丢", async () => {
    const sessionId = `${SESSION_PREFIX}_creator`;
    const persistence: ThreadPersistenceRef = { baseDir, sessionId, objectId: "agent_c", threadId: "t_main" };
    await createFlowObject(persistence);

    // makeThread（!skipCreatorWindow）经 initThreadContextWindows 注入自己视角 thread 窗（带占位 creator 通道）。
    const thread = makeThread({ id: "t_main", persistence });
    for (let i = 0; i < 6; i++) thread.events.push(mkTextEvent(i));
    const threadWinId = threadWindowIdOf("t_main");
    expect(thread.contextWindows.some((w) => w.id === threadWinId)).toBe(true);

    // 折叠前 transcript 6 条 assistant 文本。
    expect(assistantTextCount((await buildInputItems(thread)).input)).toBe(6);

    // 折叠态写入 thread 窗 win（折早期 4 条，保末 2）——模拟 fork-summarizer + harvest 产物。
    foldDirectly(thread, threadWinId, { fromIdx: 0, toIdx: 3, summary: "早期四轮：建立任务上下文" });
    expect(summarizedRangesOf(thread, threadWinId).length).toBe(1);

    // 持久化 + reload（模拟 scheduler_yielded → reload）。
    await writeThread(thread);
    const restored = await readThread({ baseDir, sessionId, objectId: "agent_c" }, "t_main");
    expect(restored).toBeDefined();

    // 折叠态跨 reload 存活（inline thread 窗，无后门、无冷启动丢窗）。
    expect(summarizedRangesOf(restored!, threadWinId).length).toBe(1);

    // reload 后 buildInputItems 投影仍折叠。
    const after = await buildInputItems(restored!);
    expect(assistantTextCount(after.input)).toBeLessThan(6);
    expect(hasEventsSummary(after.input)).toBe(true);
  });

  it("self-driven root：空 creator 通道的 thread 窗承载折叠 → reload 不丢", async () => {
    const sessionId = `${SESSION_PREFIX}_root`;
    const persistence: ThreadPersistenceRef = { baseDir, sessionId, objectId: "agent_root", threadId: "t_root_self" };
    await createFlowObject(persistence);
    const threadWinId = threadWindowIdOf("t_root_self");

    // self-driven root：手动注入**空 creator 通道**的 thread 窗（skipCreatorWindow 避免 makeThread 给占位 creator）。
    const threadWindow = {
      id: threadWinId,
      parentWindowId: ROOT_WINDOW_ID,
      title: "thread",
      status: "open",
      createdAt: 1,
      object: { class: THREAD_CLASS_ID, data: {} },
      win: { transient: true },
    } as unknown as ContextWindow;
    const thread = makeThread({
      id: "t_root_self",
      persistence,
      extraWindows: [threadWindow],
      skipCreatorWindow: true,
    });
    for (let i = 0; i < 6; i++) thread.events.push(mkTextEvent(i));

    foldDirectly(thread, threadWinId, { fromIdx: 0, toIdx: 3, summary: "root 早期摘要" });
    expect(summarizedRangesOf(thread, threadWinId).length).toBe(1);

    await writeThread(thread);
    const restored = await readThread({ baseDir, sessionId, objectId: "agent_root" }, "t_root_self");
    expect(restored).toBeDefined();
    expect(summarizedRangesOf(restored!, threadWinId).length).toBe(1);

    const after = await buildInputItems(restored!);
    expect(assistantTextCount(after.input)).toBeLessThan(6);
    expect(hasEventsSummary(after.input)).toBe(true);
  });

  it("v2 in-flight：win.inFlightCompress 跨 reload 持久（reload 后 harvest/force-wait 仍认在途 summarizer fork）", async () => {
    const sessionId = `${SESSION_PREFIX}_inflight`;
    const persistence: ThreadPersistenceRef = { baseDir, sessionId, objectId: "agent_if", threadId: "t_if" };
    await createFlowObject(persistence);
    const thread = makeThread({ id: "t_if", persistence });
    for (let i = 0; i < 6; i++) thread.events.push(mkTextEvent(i));
    const threadWinId = threadWindowIdOf("t_if");

    // 模拟 spawnSummarizerFork 置的在途标记（fork 跨 job 仍在跑时，标记须随 thread 窗持久）。
    const w = thread.contextWindows.find((x) => x.id === threadWinId)!;
    ((w as { win?: Record<string, unknown> }).win ??= {}).inFlightCompress = {
      forkThreadId: "t_fork_x",
      fromIdx: 0,
      toIdx: 3,
    };

    await writeThread(thread);
    const restored = await readThread({ baseDir, sessionId, objectId: "agent_if" }, "t_if");
    expect(restored).toBeDefined();
    // inFlightCompress 随 inline thread 窗跨 reload 存活 → reload 后 harvest 能找回 fork、force-wait 仍生效。
    expect(inFlightOf(restored!, threadWinId)).toEqual({ forkThreadId: "t_fork_x", fromIdx: 0, toIdx: 3 });
  });
});
