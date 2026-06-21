import { describe, expect, test } from "bun:test";
import { computeWindowContentHash } from "../../observable/window-hash.js";
import { countSessionReferences } from "../object-lifecycle.js";
import { WindowManager } from "../window-manager.js";
import { createObjectRegistry } from "../object-registry.js";
import { THREAD_CLASS_ID } from "../../_shared/types/constants.js";
import { threadWindowIdOf } from "../../_shared/types/context-window.js";
import { setSessionObject } from "../session-object-table.js";
import type { OocObjectRef, OocObjectInstance } from "../ooc-class.js";

/**
 * split-invariants —— object / context-window 拆分（issue 2026-06-21-object-contextwindow-split）
 * 的**回归网**：B→A 后窗（OocObjectRef）不持 data（data 在 session 对象表）、win 仍在窗。这三条
 * 不变量任一被结构改动打破即红。
 */

// 窗（OocObjectRef）：纯 ref + 视角态 + win，不持 data。
const inst = (over: Partial<OocObjectRef> & { class?: string }): OocObjectRef => {
  const { class: cls, ...rest } = over;
  return {
    id: "w",
    class: cls ?? "x",
    title: "t",
    status: "open",
    createdAt: 0,
    ...rest,
  };
};

/** 建一张含单窗 data 的临时对象表（hash 须经表解析 data）。 */
const tableWith = (id: string, data: unknown): Map<string, OocObjectInstance> => {
  const m = new Map<string, OocObjectInstance>();
  m.set(id, { id, class: "x", data });
  return m;
};

describe("split-invariant 1: refcount（拆分后 referencedObjectId 双读 objectRef 不得改变计数语义）", () => {
  test("fork 窗在 → count 1；移除该窗 → count 0", () => {
    const forkWin = inst({ id: "w_fork", class: THREAD_CLASS_ID });
    const parent = {
      id: "t_p",
      status: "running",
      contextWindows: [forkWin],
      childThreads: {},
    } as unknown as Parameters<typeof countSessionReferences>[0];
    // B→A：fork 窗 data 活在 session 对象表（按窗 id 键）。
    setSessionObject(parent, {
      id: "w_fork",
      class: THREAD_CLASS_ID,
      data: { isForkWindow: true, targetThreadId: "t_c" },
    });
    expect(countSessionReferences(parent, "t_c")).toBe(1);
    (parent as { contextWindows: unknown[] }).contextWindows = [];
    expect(countSessionReferences(parent, "t_c")).toBe(0);
  });
});

describe("split-invariant 2: window-hash content-sensitivity（object data 与 view win 都须进 hash）", () => {
  test("object data 变 → hash 变", () => {
    const w = inst({ id: "w_h" });
    expect(computeWindowContentHash(w, tableWith("w_h", { x: 1 }))).not.toBe(
      computeWindowContentHash(w, tableWith("w_h", { x: 2 })),
    );
  });
  test("view win（非 compressLevel 易变态）变 → hash 变", () => {
    const data = { same: true };
    expect(
      computeWindowContentHash(
        inst({ id: "w_h", win: { viewport: { tail: 10 } } }),
        tableWith("w_h", data),
      ),
    ).not.toBe(
      computeWindowContentHash(
        inst({ id: "w_h", win: { viewport: { tail: 20 } } }),
        tableWith("w_h", data),
      ),
    );
  });
});

describe("split-invariant 3: WindowManager round-trip 不丢 win（compress summarizedRanges 在 view win）", () => {
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
