/**
 * compress v2 真实 LLM 端到端 —— spawnSummarizerFork → 真 LLM summarizer 子线程读早期 transcript
 * 生成摘要 → end({summary}) → scheduler harvest 折入 parent self-view thread 窗 summarizedRanges。
 *
 * 验证 active fork-summarize 全链（确定性 threshold/trigger/harvest 已由 compress-v2.test.ts 覆盖）。
 * gate：RUN_REAL_COMPRESS_TEST=1（需 .env 真 LLM）。
 * 跑：RUN_REAL_COMPRESS_TEST=1 bun test packages/@ooc/core/thinkable/__tests__/real-compress-v2.test.ts
 */
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import "@ooc/core/runtime/register-builtins.js";
import { builtinRegistry } from "@ooc/core/runtime/object-registry.js";
import { createStoneObject, ensureStoneRepo, createFlowObject } from "../../persistable";
import { writeSelf } from "@ooc/builtins/agent/persistable/self-md.js";
import { ROOT_WINDOW_ID, threadWindowIdOf, isSelfThreadWindow, objectDataOf } from "@ooc/core/_shared/types/context-window.js";
import { getSessionObjectTable, materializeWindow } from "@ooc/core/runtime/session-object-table.js";
import { THREAD_CLASS_ID } from "@ooc/core/_shared/types/constants.js";
import { createLlmClient } from "../llm/client";
import { harvestSummarizerForks, spawnSummarizerFork } from "@ooc/builtins/agent/thread/executable/compress.js";
import { think } from "../thinkloop";
import type { ThreadContext } from "@ooc/core/_shared/types/thread.js";

function loadRealEnv(): void {
  const envPaths = [resolve(process.cwd(), ".env"), resolve(process.cwd(), "../../.env")];
  for (const envPath of envPaths) {
    if (!existsSync(envPath)) continue;
    const content = readFileSync(envPath, "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const sep = trimmed.indexOf("=");
      if (sep <= 0) continue;
      process.env[trimmed.slice(0, sep)] = trimmed.slice(sep + 1);
    }
    return;
  }
}

const shouldRun = process.env.RUN_REAL_COMPRESS_TEST === "1";
const TESTER = "compress_v2_tester";

describe.skipIf(!shouldRun)("compress v2 —— 真实 LLM auto fork-summarize", () => {
  let world: string;

  beforeAll(async () => {
    loadRealEnv();
    world = await mkdtemp(join(tmpdir(), "ooc-real-compress-v2-"));
    await ensureStoneRepo({ baseDir: world });
    await createStoneObject({ baseDir: world, objectId: TESTER });
    await writeSelf({ baseDir: world, objectId: TESTER }, "# compress_v2_tester\nfork-summarize 验证对象。");
    if (!builtinRegistry.has(TESTER)) {
      builtinRegistry.register(TESTER, { executable: { methods: [] } } as never, { parentClass: null });
    }
  });

  afterAll(async () => {
    if (world) await rm(world, { recursive: true, force: true });
  });

  it("spawnSummarizerFork → 真 LLM 子线程摘要 → harvest 折入 summarizedRanges", async () => {
    const threadId = "t_v2_real";
    await createFlowObject({ baseDir: world, sessionId: "s_v2", objectId: TESTER });
    // 25 条早期过程 events（fold [0..4]，保末 20）。
    const events: ThreadContext["events"] = Array.from({ length: 25 }, (_, i) => ({
      category: "llm_interaction",
      kind: "text",
      text: `第${i + 1}步：解析器实现进展——读文件/写 tokenizer/补测试，第 ${i + 1} 轮的具体动作与结论。`,
    }));
    const thread: ThreadContext = {
      id: threadId,
      status: "running",
      events,
      contextWindows: [],
      persistence: { baseDir: world, sessionId: "s_v2", objectId: TESTER, threadId },
    } as unknown as ThreadContext;
    // self thread 窗 = ref + object 入 session 对象表（materializeWindow 一处搞定）。
    thread.contextWindows = [
      materializeWindow(thread, {
        id: threadWindowIdOf(threadId),
        class: THREAD_CLASS_ID,
        data: {},
        parentWindowId: ROOT_WINDOW_ID,
        title: "thread",
        status: "open",
        createdAt: 1,
        win: {},
      }),
    ];

    // 直接 spawn summarizer fork 压缩 events[0..4]（确定性触发；auto-trigger 的判定已由单测覆盖）。
    const forkId = await spawnSummarizerFork(thread, 0, 4);
    expect(forkId).toBeDefined();
    const win = () =>
      thread.contextWindows!.find((w) => isSelfThreadWindow(w.id))!.win as {
        summarizedRanges?: Array<{ fromIdx: number; toIdx: number; summary: string }>;
        inFlightCompress?: unknown;
      };
    expect((win().inFlightCompress as { forkThreadId?: string })?.forkThreadId).toBe(forkId);
    // 父侧 summarizer fork 窗已移除（不污染窗列表）。
    expect(thread.contextWindows!.some((w) => (objectDataOf(w, getSessionObjectTable(thread)) as { targetThreadId?: string } | undefined)?.targetThreadId === forkId)).toBe(false);
    // child 在 childThreads（直接驱动它跑一轮，隔离机制：不经 runScheduler 避免唤醒后 parent 空跑）。
    const forkChild = thread.childThreads![forkId!]!;
    expect(forkChild).toBeDefined();

    // 直接跑 summarizer fork 一轮真 LLM —— isSummarizer 单轮：首轮文本即摘要 → endSummary + done。
    const client = createLlmClient();
    await think(forkChild, client);
    expect(forkChild.status).toBe("done");
    expect((forkChild.endSummary ?? "").trim().length).toBeGreaterThan(0);

    // harvest 折入 summarizedRanges{0,4,<真 LLM 摘要>} + 清 inFlightCompress。
    harvestSummarizerForks(thread);
    const ranges = win().summarizedRanges ?? [];
    expect(ranges.length).toBe(1);
    expect(ranges[0]!.fromIdx).toBe(0);
    expect(ranges[0]!.toIdx).toBe(4);
    expect(ranges[0]!.summary.trim().length).toBeGreaterThan(0);
    expect(win().inFlightCompress).toBeUndefined();

    // eslint-disable-next-line no-console
    console.log(`[real-compress-v2] forkId=${forkId} summary="${ranges[0]!.summary.slice(0, 150)}"`);
  }, 180000);
});
