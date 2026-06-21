import { describe, expect, test } from "bun:test";
import { computeWindowContentHash } from "../../observable/window-hash.js";
import { countSessionReferences } from "../object-lifecycle.js";
import { WindowManager } from "../window-manager.js";
import { createObjectRegistry } from "../object-registry.js";
import { THREAD_CLASS_ID } from "../../_shared/types/constants.js";
import { threadWindowIdOf } from "../../_shared/types/context-window.js";
import type { OocObjectInstance } from "../ooc-class.js";

/**
 * split-invariants —— object / context-window 拆分（issue 2026-06-21-object-contextwindow-split）
 * 的**回归网**：P1（WindowManager 承重墙改造）/ P2（objectCache + 读者迁移）改动前先钉死这三条
 * 不变量，任一被结构改动打破即红。
 */

const inst = (over: Partial<OocObjectInstance>): OocObjectInstance => ({
  id: "w",
  class: "x",
  title: "t",
  status: "open",
  createdAt: 0,
  data: {},
  ...over,
});

describe("split-invariant 1: refcount（P1 必保——拆分后 referencedObjectId 双读 objectRef 不得改变计数语义）", () => {
  test("fork 窗在 → count 1；移除该窗 → count 0", () => {
    const forkWin = inst({
      id: "w_fork",
      class: THREAD_CLASS_ID,
      data: { isForkWindow: true, targetThreadId: "t_c" },
    });
    const parent = {
      id: "t_p",
      status: "running",
      contextWindows: [forkWin],
      childThreads: {},
    } as unknown as Parameters<typeof countSessionReferences>[0];
    expect(countSessionReferences(parent, "t_c")).toBe(1);
    (parent as { contextWindows: unknown[] }).contextWindows = [];
    expect(countSessionReferences(parent, "t_c")).toBe(0);
  });
});

describe("split-invariant 2: window-hash content-sensitivity（P2 必保——object data 与 view win 都须进 hash）", () => {
  test("object data 变 → hash 变", () => {
    expect(computeWindowContentHash(inst({ data: { x: 1 } }))).not.toBe(
      computeWindowContentHash(inst({ data: { x: 2 } })),
    );
  });
  test("view win（非 compressLevel 易变态）变 → hash 变", () => {
    expect(computeWindowContentHash(inst({ win: { viewport: { tail: 10 } } }))).not.toBe(
      computeWindowContentHash(inst({ win: { viewport: { tail: 20 } } })),
    );
  });
});

describe("split-invariant 3: WindowManager round-trip 不丢 win（P1 必保——compress summarizedRanges 在 view win）", () => {
  test("win.summarizedRanges 过 fromThread→toData 存活", () => {
    const reg = createObjectRegistry();
    const selfWin = inst({
      id: threadWindowIdOf("t_p"),
      class: THREAD_CLASS_ID,
      win: { summarizedRanges: [{ fromIdx: 0, toIdx: 3, summary: "s" }] },
    });
    const thread = {
      id: "t_p",
      status: "running",
      contextWindows: [selfWin],
      childThreads: {},
    } as unknown as Parameters<typeof WindowManager.fromThread>[0];
    const out = WindowManager.fromThread(thread, reg).toData();
    const w = out.find((x) => x.id === threadWindowIdOf("t_p"));
    expect(
      (w?.win as { summarizedRanges?: { summary: string }[] } | undefined)?.summarizedRanges?.[0]?.summary,
    ).toBe("s");
  });
});
