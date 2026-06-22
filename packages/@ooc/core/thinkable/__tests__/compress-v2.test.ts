/**
 * compress v2 —— 确定性单测（无真 LLM）：阈值映射 / 触发判定 / harvest（fold·clear·wake·failed）。
 * spawn summarizer fork 的端到端（真 fork + LLM 摘要）由 real-compress / e2e gate 验。
 */
import { describe, expect, it } from "bun:test";
import {
  autoCompressThreshold,
  shouldAutoCompress,
} from "../context/compress-trigger";
import { harvestSummarizerForks } from "@ooc/builtins/agent/thread/executable/compress.js";
import { threadWindowIdOf } from "@ooc/core/_shared/types/context-window.js";
import { THREAD_CLASS_ID } from "@ooc/core/_shared/types/constants.js";
import type { ThreadContext } from "../context";

const THRESHOLDS = { soft: 100000, hard: 180000 };

describe("compress v2 — autoCompressThreshold（档位→未总结 transcript token 阈值）", () => {
  it("0/缺省=hard（仅超 hard 才由 force-wait 兜底触发）", () => {
    expect(autoCompressThreshold(0, THRESHOLDS)).toBe(180000);
    expect(autoCompressThreshold(undefined, THRESHOLDS)).toBe(180000);
  });
  it("1=soft，2=soft/2（越高档越激进）", () => {
    expect(autoCompressThreshold(1, THRESHOLDS)).toBe(100000);
    expect(autoCompressThreshold(2, THRESHOLDS)).toBe(50000);
  });
});

describe("compress v2 — shouldAutoCompress（transcript-gated H3）", () => {
  it("在途 compress → 永不再触发", () => {
    expect(
      shouldAutoCompress({ transcriptTokens: 999999, autoCompressLevel: 2, compressIntent: true, inFlight: true, thresholds: THRESHOLDS }),
    ).toBe(false);
  });
  it("compressIntent → 触发（无视阈值）", () => {
    expect(
      shouldAutoCompress({ transcriptTokens: 0, autoCompressLevel: 0, compressIntent: true, inFlight: false, thresholds: THRESHOLDS }),
    ).toBe(true);
  });
  it("未总结 transcript 超档位阈值 → 触发；未超 → 不触发", () => {
    expect(
      shouldAutoCompress({ transcriptTokens: 120000, autoCompressLevel: 1, compressIntent: false, inFlight: false, thresholds: THRESHOLDS }),
    ).toBe(true);
    expect(
      shouldAutoCompress({ transcriptTokens: 80000, autoCompressLevel: 1, compressIntent: false, inFlight: false, thresholds: THRESHOLDS }),
    ).toBe(false);
  });
  it("level 0 + 未超 hard → 不触发（不主动）", () => {
    expect(
      shouldAutoCompress({ transcriptTokens: 150000, autoCompressLevel: 0, compressIntent: false, inFlight: false, thresholds: THRESHOLDS }),
    ).toBe(false);
  });
});

/** 造一个带 self-view thread 窗（含 compress v2 win 态）的 parent + 一个 summarizer 子线程。 */
function makeParentWithInFlight(opts: {
  childStatus: "running" | "done" | "failed";
  endSummary?: string;
  waiting?: boolean;
  childPresent?: boolean;
  autoCompressLevel?: 0 | 1 | 2;
}): ThreadContext {
  const parentId = "t_parent";
  const forkId = "t_fork_sum";
  const child: ThreadContext = {
    id: forkId,
    status: opts.childStatus,
    events: [],
    isSummarizer: true,
    endSummary: opts.endSummary,
  } as unknown as ThreadContext;
  const parent: ThreadContext = {
    id: parentId,
    status: opts.waiting ? "waiting" : "running",
    events: [],
    waitingOn: opts.waiting ? `compress:${forkId}` : undefined,
    inboxSnapshotAtWait: opts.waiting ? 0 : undefined,
    childThreadIds: [forkId],
    childThreads: opts.childPresent === false ? {} : { [forkId]: child },
    contextWindows: [
      {
        id: threadWindowIdOf(parentId),
        class: THREAD_CLASS_ID,
        title: "thread",
        status: "open",
        createdAt: 1,
        data: {},
        win: {
          autoCompressLevel: opts.autoCompressLevel ?? 2,
          inFlightCompress: { forkThreadId: forkId, fromIdx: 0, toIdx: 2 },
        },
      },
    ],
  } as unknown as ThreadContext;
  return parent;
}

function selfWinOf(thread: ThreadContext): {
  summarizedRanges?: Array<{ fromIdx: number; toIdx: number; summary: string }>;
  inFlightCompress?: unknown;
  autoCompressLevel?: number;
} {
  return (thread.contextWindows!.find((w) => w.id === threadWindowIdOf(thread.id))!.win ?? {}) as never;
}

describe("compress v2 — harvestSummarizerForks", () => {
  it("done → 记 summarizedRanges{fromIdx,toIdx,summary} + 清 inFlightCompress + 唤醒 waiting 父 + 可见 compressed 事件", () => {
    const parent = makeParentWithInFlight({ childStatus: "done", endSummary: "早期三轮摘要", waiting: true });
    harvestSummarizerForks(parent);
    const win = selfWinOf(parent);
    expect(win.summarizedRanges).toEqual([{ fromIdx: 0, toIdx: 2, summary: "早期三轮摘要" }]);
    expect(win.inFlightCompress).toBeUndefined();
    expect(parent.status).toBe("running"); // 唤醒
    expect(parent.waitingOn).toBeUndefined();
    expect(parent.events.some((e) => e.category === "context_change" && e.kind === "context_compressed")).toBe(true);
  });

  it("running → 不动（还在跑）", () => {
    const parent = makeParentWithInFlight({ childStatus: "running", waiting: true });
    harvestSummarizerForks(parent);
    const win = selfWinOf(parent);
    expect(win.inFlightCompress).toBeDefined();
    expect(parent.status).toBe("waiting");
  });

  it("failed → 关 autoCompressLevel（防 livelock）+ 清 inFlightCompress + 不记 fold", () => {
    const parent = makeParentWithInFlight({ childStatus: "failed", waiting: true, autoCompressLevel: 2 });
    harvestSummarizerForks(parent);
    const win = selfWinOf(parent);
    expect(win.summarizedRanges ?? []).toEqual([]);
    expect(win.inFlightCompress).toBeUndefined();
    expect(win.autoCompressLevel).toBe(0);
    expect(parent.status).toBe("running");
  });

  it("orphan（child 丢失/crash）→ 清 inFlightCompress 解除 force-wait", () => {
    const parent = makeParentWithInFlight({ childStatus: "done", childPresent: false, waiting: true });
    harvestSummarizerForks(parent);
    const win = selfWinOf(parent);
    expect(win.inFlightCompress).toBeUndefined();
    expect(parent.status).toBe("running");
  });
});
