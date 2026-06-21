/**
 * object-lifecycle.test.ts — referencedObjectId / countSessionReferences / dispatchUnactiveIfZero
 * 的纯单元测试（spec §3，plan Phase 1）。零 thread builtin import；合成窗/线程/class。
 */
import { describe, expect, test, afterEach } from "bun:test";
import { existsSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  referencedObjectId,
  countSessionReferences,
  dispatchUnactiveIfZero,
  dispatchActiveIfFirst,
} from "../object-lifecycle";
import { threadWindowIdOf } from "../../_shared/types/context-window";
import { THREAD_CLASS_ID } from "../../_shared/types/constants";
import { objectDir } from "../../persistable/common";
import { createObjectRegistry } from "../object-registry";
import type { OocObjectInstance } from "../ooc-class";
import type { ThreadContext } from "../../_shared/types/thread";

// ─────────────────────────── helpers ───────────────────────────

const forkWin = (id: string, targetThreadId: string): OocObjectInstance =>
  ({
    id,
    title: "",
    status: "open",
    createdAt: 0,
    object: { class: THREAD_CLASS_ID, data: { isForkWindow: true, targetThreadId } },
  }) as OocObjectInstance;

const thr = (
  id: string,
  status: string,
  windows: OocObjectInstance[],
): ThreadContext =>
  ({
    id,
    status,
    events: [],
    contextWindows: windows,
    childThreads: {},
  }) as unknown as ThreadContext;

// ─────────────────────────── Task 1.1: referencedObjectId ───────────────────────────

describe("referencedObjectId (fork-only)", () => {
  test("fork 窗 → targetThreadId", () => {
    expect(referencedObjectId(forkWin("w1", "t_child"))).toBe("t_child");
  });

  test("self 门面窗（threadWindowIdOf 前缀）→ undefined（自引用不计）", () => {
    expect(
      referencedObjectId(forkWin(threadWindowIdOf("t_self"), "t_self")),
    ).toBeUndefined();
  });

  test("peer 窗（无 isForkWindow）→ undefined", () => {
    const w = {
      id: "w_peer",
      title: "",
      status: "open",
      createdAt: 0,
      object: { class: THREAD_CLASS_ID, data: { target: "alice", targetThreadId: "t_alice" } },
    } as OocObjectInstance;
    expect(referencedObjectId(w)).toBeUndefined();
  });

  test("独立成员窗（filesystem，带 objectRef）→ 该对象 id（P1 phase-2 合并）", () => {
    // P1 起独立对象窗自描述为引用（objectRef）；referencedObjectId 双读直接返回 objectRef.objectId。
    // 这是 lifecycle phase-2「referencedObjectId 扩到 member 窗」的合并——独立成员/对象窗纳入计数解析。
    const w = {
      id: "w_file",
      title: "",
      status: "open",
      createdAt: 0,
      object: { class: "_builtin/filesystem/file", data: {} },
      objectRef: { objectId: "w_file", class: "_builtin/filesystem/file" },
    } as OocObjectInstance;
    expect(referencedObjectId(w)).toBe("w_file");
  });

  test("缺 targetThreadId 的 fork 窗 → undefined", () => {
    const w = {
      id: "w_nf",
      title: "",
      status: "open",
      createdAt: 0,
      object: { class: THREAD_CLASS_ID, data: { isForkWindow: true } },
    } as OocObjectInstance;
    expect(referencedObjectId(w)).toBeUndefined();
  });
});

// ─────────────────────── Task 1.2: countSessionReferences ───────────────────────

describe("countSessionReferences (内存树, 排除 done/failed/canceled)", () => {
  test("fork 子仅被父 fork 窗引用 → 1；父去窗 → 0", () => {
    const p = thr("t_p", "running", [forkWin("w_f", "t_c")]);
    expect(countSessionReferences(p, "t_c")).toBe(1);
    p.contextWindows = [];
    expect(countSessionReferences(p, "t_c")).toBe(0);
  });

  test("沿 childThreads 递归统计", () => {
    const child = thr("t_c", "running", [forkWin("w_gc", "t_gc")]);
    const p = thr("t_p", "running", [forkWin("w_c", "t_c")]);
    (p.childThreads as Record<string, ThreadContext>)["t_c"] = child;
    expect(countSessionReferences(p, "t_gc")).toBe(1);
    expect(countSessionReferences(p, "t_c")).toBe(1);
  });

  test("从子线程入口也能沿 _parentThreadRef 到根再统计全树", () => {
    const child = thr("t_c", "running", [forkWin("w_gc", "t_gc")]);
    const p = thr("t_p", "running", [forkWin("w_c", "t_c")]);
    (p.childThreads as Record<string, ThreadContext>)["t_c"] = child;
    (child as unknown as { _parentThreadRef?: ThreadContext })._parentThreadRef = p;
    // 从 child 入口 → 应回到根 p → 看到 t_c 的引用
    expect(countSessionReferences(child, "t_c")).toBe(1);
  });

  test("canceled 线程持有的引用不计数", () => {
    const c = thr("t_c2", "canceled", [forkWin("w", "x")]);
    const p = thr("t_p2", "running", []);
    (p.childThreads as Record<string, ThreadContext>)["t_c2"] = c;
    expect(countSessionReferences(p, "x")).toBe(0);
  });

  test("done / failed 线程持有的引用不计数", () => {
    const done = thr("t_done", "done", [forkWin("w_d", "x")]);
    const failed = thr("t_fail", "failed", [forkWin("w_e", "y")]);
    const p = thr("t_p3", "running", []);
    (p.childThreads as Record<string, ThreadContext>)["t_done"] = done;
    (p.childThreads as Record<string, ThreadContext>)["t_fail"] = failed;
    expect(countSessionReferences(p, "x")).toBe(0);
    expect(countSessionReferences(p, "y")).toBe(0);
  });

  test("paused 线程的引用计数（活动态）", () => {
    const paused = thr("t_pause", "paused", [forkWin("w_p", "z")]);
    const p = thr("t_p4", "running", []);
    (p.childThreads as Record<string, ThreadContext>)["t_pause"] = paused;
    expect(countSessionReferences(p, "z")).toBe(1);
  });
});

// ─────────────────────── Task 1.3: dispatchUnactiveIfZero ───────────────────────

describe("dispatchUnactiveIfZero (单次泛型, fast-path)", () => {
  test("refcount 0 + class 有 unactive → 钩子被调（经 ctx.targetId）", async () => {
    const reg = createObjectRegistry();
    let got = "";
    reg.register(THREAD_CLASS_ID, {
      unactive: { description: "", exec: (ctx) => { got = ctx.targetId; } },
    });
    const p = thr("t_p", "running", []);
    await dispatchUnactiveIfZero(p, "t_c", THREAD_CLASS_ID, reg);
    expect(got).toBe("t_c");
  });

  test("class 无 unactive → fast-path no-op（钩子不被调）", async () => {
    const reg = createObjectRegistry();
    const p = thr("t", "running", []);
    // 未注册 unactive 的 class：不应抛、不应改任何状态。
    await dispatchUnactiveIfZero(p, "filesystem", "_builtin/filesystem", reg);
    expect(p.contextWindows).toEqual([]);
  });

  test("refcount > 0 → 钩子不被调", async () => {
    const reg = createObjectRegistry();
    let called = false;
    reg.register(THREAD_CLASS_ID, {
      unactive: { description: "", exec: () => { called = true; } },
    });
    // 父仍持有指向 t_c 的 fork 窗 → refcount 1 → 不派发。
    const p = thr("t_p", "running", [forkWin("w_f", "t_c")]);
    await dispatchUnactiveIfZero(p, "t_c", THREAD_CLASS_ID, reg);
    expect(called).toBe(false);
  });

  test("unactive 返回 {delete:true} → 删 objectDir（合成 class, 临时 world）", async () => {
    // refcount=0：解引用的窗已被 close 移除（dispatch 前置条件）。建 objectDir 落文件，dispatch 后断言已删。
    const reg = createObjectRegistry();
    reg.register("_test/gc", {
      unactive: { description: "", exec: () => ({ delete: true }) },
    });
    const baseDir = join(tmpdir(), `ooc-lifecycle-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const sessionId = "s1";
    const objId = "o_gc";
    const dir = objectDir({ baseDir, sessionId, objectId: objId });
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "data.json"), "{}");
    expect(existsSync(dir)).toBe(true);

    // 持有窗已移除 → refcount 0。
    const p = thr("t", "running", []);
    (p as unknown as { persistence?: unknown }).persistence = { baseDir, sessionId, objectId: "t_owner", threadId: "t" };

    await dispatchUnactiveIfZero(p, objId, "_test/gc", reg);

    expect(existsSync(dir)).toBe(false);
    rmSync(baseDir, { recursive: true, force: true });
  });

  test("delete 路径过滤掉残留引用 targetId 的内存窗（防御清理）", async () => {
    // 残留引用窗活在退出态（canceled）线程 → refcount 0 → dispatch 仍触发；removeObjectFromSession
    // 把 ctxThread 顶层引用 targetId 的窗过滤掉（防御性内存清理）。
    const reg = createObjectRegistry();
    reg.register("_test/gc2", {
      unactive: { description: "", exec: () => ({ delete: true }) },
    });
    // 顶层有一个引用 o_x 的窗，但其所在线程是 canceled（退出态）→ 不计入 refcount → dispatch 触发删除。
    const p = thr("t_np", "canceled", [forkWin("w_ref", "o_x")]);
    await dispatchUnactiveIfZero(p, "o_x", "_test/gc2", reg);
    expect(p.contextWindows.some((w) => referencedObjectId(w) === "o_x")).toBe(false);
  });
});

// ─────────────────────── active dispatch (0→1, fast-path) ───────────────────────
describe("dispatchActiveIfFirst (0→1, fast-path)", () => {
  test("refcount 1（首个引用窗）+ class 有 active → 钩子被调（经 ctx.targetId）", async () => {
    const reg = createObjectRegistry();
    let got = "";
    reg.register(THREAD_CLASS_ID, {
      active: { description: "", exec: (ctx) => { got = ctx.targetId; } },
    });
    const p = thr("t_p", "running", [forkWin("w_f", "t_c")]); // 一个引用 t_c 的 fork 窗 → refcount 1
    await dispatchActiveIfFirst(p, "t_c", THREAD_CLASS_ID, reg);
    expect(got).toBe("t_c");
  });

  test("refcount 2（已被多窗引用，非 0→1）→ 钩子不被调", async () => {
    const reg = createObjectRegistry();
    let called = false;
    reg.register(THREAD_CLASS_ID, {
      active: { description: "", exec: () => { called = true; } },
    });
    const p = thr("t_p", "running", [forkWin("w1", "t_c"), forkWin("w2", "t_c")]); // refcount 2
    await dispatchActiveIfFirst(p, "t_c", THREAD_CLASS_ID, reg);
    expect(called).toBe(false);
  });

  test("class 无 active → fast-path no-op（不算 refcount、不 throw）", async () => {
    const reg = createObjectRegistry();
    const p = thr("t_p", "running", [forkWin("w_f", "t_c")]);
    await dispatchActiveIfFirst(p, "t_c", "_builtin/filesystem", reg);
    expect(true).toBe(true);
  });
});
