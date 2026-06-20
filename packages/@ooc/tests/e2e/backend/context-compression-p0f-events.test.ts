/**
 * compress Case A —— 跨 job（scheduler_yielded → reload）events 折叠持久化 e2e gate。
 *
 * 验证载体收敛后的归宿：events 折叠态挂**自己视角 thread 窗**（class=THREAD_CLASS_ID，inline 持久化）：
 *   1. 经 exec(window_id=thread 窗, method="compress", scope=events) 写入 win.summarizedRanges；
 *   2. writeThread → readThread（模拟 job 切片 scheduler_yielded → reload）；
 *   3. 折叠态跨 reload 存活（THREAD_CLASS_ID inline 整窗落 thread-context.json、builtin 类 hydrate 恒注册）；
 *   4. reload 后 buildInputItems 投影仍折叠（assistant 文本数降 + events_summary 出现）。
 *   含 **self-driven root**（空 creator 通道的 thread 窗）用例——它没有上游 creator，但同样承载 events 折叠。
 *
 * 取代旧 `_foldedBy` object-data 折叠 e2e（已退役：折叠改 win 投影态、不改 thread.events）。
 * fixture-based、零真 LLM、可进 CI。
 */

import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { makeThread } from "@ooc/core/__tests__/make-thread";
import { dispatchToolCall } from "@ooc/core/executable/tools";
import type { ProcessEvent } from "@ooc/core/thinkable/context";
import { buildInputItems } from "@ooc/core/thinkable/context";
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

const SESSION_PREFIX = "_test_compress_caseA";

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

/** 经 exec 在指定 thread 窗上 compress(scope=events)。 */
async function compressEventsOn(
  thread: Parameters<typeof dispatchToolCall>[0],
  threadWinId: string,
  args: Record<string, unknown>,
): Promise<void> {
  const out = await dispatchToolCall(thread, {
    id: "c1",
    name: "exec",
    arguments: { method: "compress", window_id: threadWinId, title: "fold early history", args: { scope: "events", ...args } },
  });
  const parsed = JSON.parse(out) as { ok?: boolean; error?: string };
  expect(parsed.error, `exec compress 失败：${parsed.error ?? ""}`).toBeUndefined();
  expect(parsed.ok).toBe(true);
}

function summarizedRangesOf(thread: { contextWindows?: ContextWindow[] }, id: string): unknown[] {
  const win = thread.contextWindows?.find((w) => w.id === id)?.win as { summarizedRanges?: unknown[] } | undefined;
  return win?.summarizedRanges ?? [];
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

    // makeThread（!skipCreatorWindow）经 initContextWindows 注入自己视角 thread 窗（带占位 creator 通道）。
    const thread = makeThread({ id: "t_main", persistence });
    for (let i = 0; i < 6; i++) thread.events.push(mkTextEvent(i));
    const threadWinId = threadWindowIdOf("t_main");
    expect(thread.contextWindows.some((w) => w.id === threadWinId)).toBe(true);

    // 折叠前 transcript 6 条 assistant 文本。
    expect(assistantTextCount((await buildInputItems(thread)).input)).toBe(6);

    // events-compress 经 exec 派发到 thread 窗 → 写 win.summarizedRanges（keepTail=2 折早期 4 条）。
    await compressEventsOn(thread, threadWinId, { keepTail: 2, summary: "早期四轮：建立任务上下文" });
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
      class: THREAD_CLASS_ID,
      parentObjectId: ROOT_WINDOW_ID,
      title: "thread",
      status: "open",
      createdAt: 1,
      data: {},
      win: { transient: true },
    } as unknown as ContextWindow;
    const thread = makeThread({
      id: "t_root_self",
      persistence,
      extraWindows: [threadWindow],
      skipCreatorWindow: true,
    });
    for (let i = 0; i < 6; i++) thread.events.push(mkTextEvent(i));

    await compressEventsOn(thread, threadWinId, { keepTail: 2, summary: "root 早期摘要" });
    expect(summarizedRangesOf(thread, threadWinId).length).toBe(1);

    await writeThread(thread);
    const restored = await readThread({ baseDir, sessionId, objectId: "agent_root" }, "t_root_self");
    expect(restored).toBeDefined();
    expect(summarizedRangesOf(restored!, threadWinId).length).toBe(1);

    const after = await buildInputItems(restored!);
    expect(assistantTextCount(after.input)).toBeLessThan(6);
    expect(hasEventsSummary(after.input)).toBe(true);
  });

  it("可逆：expand(scope=events) 清空折叠态 → reload 后 transcript 完整还原", async () => {
    const sessionId = `${SESSION_PREFIX}_expand`;
    const persistence: ThreadPersistenceRef = { baseDir, sessionId, objectId: "agent_e", threadId: "t_exp" };
    await createFlowObject(persistence);
    const thread = makeThread({ id: "t_exp", persistence });
    for (let i = 0; i < 6; i++) thread.events.push(mkTextEvent(i));
    const threadWinId = threadWindowIdOf("t_exp");

    await compressEventsOn(thread, threadWinId, { keepTail: 2, summary: "折叠" });
    expect(assistantTextCount((await buildInputItems(thread)).input)).toBeLessThan(6);

    // expand 清空折叠（不给 at）→ 还原。
    const out = await dispatchToolCall(thread, {
      id: "e1",
      name: "exec",
      arguments: { method: "expand", window_id: threadWinId, title: "expand all", args: { scope: "events" } },
    });
    expect((JSON.parse(out) as { ok?: boolean }).ok).toBe(true);
    expect(summarizedRangesOf(thread, threadWinId).length).toBe(0);

    await writeThread(thread);
    const restored = await readThread({ baseDir, sessionId, objectId: "agent_e" }, "t_exp");
    expect(assistantTextCount((await buildInputItems(restored!)).input)).toBe(6);
  });
});
