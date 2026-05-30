/**
 * plan_window 跨 thread share 完整闭环 e2e（Round 7 Phase B6）。
 *
 * Design: docs/2026-05-26-remove-issue-add-subplan-design.md §3.6
 * Meta:
 *   - meta/object.doc.ts:executable.children.context_window.children.plan_window
 *   - meta/object.doc.ts:executable.children.context_window.children.sharing
 *   - meta/object.doc.ts:collaborable.children.cross_thread_window_sharing
 *
 * 三个剧本（与本轮 B6 派单口径一致）：
 *
 *   Scenario A (move) — 完整闭环：
 *     父建 plan → share 给子 (mode=move) → 父侧 lent_out + 不可写
 *     → 子 update_step + expand_step + 在 sub plan add_step → 子归还
 *     → 父恢复 owner + 看到子侧的最新 steps；sub plan 是否随父一起回流交由现实断言记录
 *
 *   Scenario B (ref) — 子只读：
 *     父建 plan → share 给子 (mode=ref) → 父侧仍 owner / live
 *     → 子在 ref 上调任何命令（含 update_step）应被守门拒绝
 *     → 子 close ref 只释放本地；父侧不变
 *
 *   Scenario C — 错误路径 / 边界：
 *     - root plan 与 sub plan 都可 share（同 plan_window 类型；现实行为）
 *     - 同一个 plan_window 已 share 过一次后，对同一子线程重复 share 的行为（看 do_window.move）
 *     - mode=move 后子未显式归还，直接 archive 父 do_window → cascade 自动归还
 *
 * 测试自身的 session 卫生：
 *   - 内存 thread（makeThread fixture）；无 .ooc-world 落盘；无 long-running 进程
 *   - 不真启 backend；用 execRootMethod + dispatchToolCall 直驱
 */

import { describe, expect, it } from "bun:test";

// side-effect: 触发 windows 注册（含 plan / do）
import "@src/executable/windows";

import { execRootMethod, WindowManager } from "@src/executable/windows";
import { dispatchToolCall } from "@src/executable/tools";
import { archiveDoWindowChild } from "@src/executable/windows/do/helpers";
import { makeThread } from "@src/__tests__/make-thread";
import type {
  ContextWindow,
  DoWindow,
  PlanWindow,
} from "@src/executable/windows/_shared/types";
import type { ThreadContext } from "@src/thinkable/context";

// ───────────────────────────── helpers ────────────────────────────────────────

/** 找出某 thread 上的某 plan_window（按 id 严格匹配）。 */
function findPlanWindowById(
  thread: ThreadContext,
  id: string,
): PlanWindow | undefined {
  const w = (thread.contextWindows ?? []).find((x) => x.id === id);
  return w && w.type === "plan" ? (w as PlanWindow) : undefined;
}

/** 找出 thread 上唯一的非 creator do_window（root.do 创建的对端通道）。 */
function findParentSideDoWindow(thread: ThreadContext): DoWindow {
  const win = (thread.contextWindows ?? []).find(
    (w) => w.type === "do" && !(w as DoWindow).isCreatorWindow,
  );
  if (!win || win.type !== "do") throw new Error("expected parent-side do_window");
  return win;
}

/** 通过子 thread 持有的 creator do_window 找到子→父归还通道。 */
function findChildCreatorDoWindow(child: ThreadContext): DoWindow {
  const win = (child.contextWindows ?? []).find(
    (w) => w.type === "do" && (w as DoWindow).isCreatorWindow,
  );
  if (!win || win.type !== "do") throw new Error("expected creator do_window on child");
  return win;
}

/** child 通过其 WindowManager 在某 plan_window 上执行命令（owner 路径）。 */
async function execOnPlanWindow(
  thread: ThreadContext,
  planWindowId: string,
  command: string,
  args: Record<string, unknown>,
): Promise<string | undefined> {
  const mgr = WindowManager.fromThread(thread);
  const result = await mgr.openCommandExec({
    thread,
    parentWindowId: planWindowId,
    command,
    title: `[test] ${command}`,
    args,
  });
  thread.contextWindows = mgr.toData();
  return result.submitResult;
}

/** 取唯一子 thread（root.do 后的 child）。 */
function getOnlyChild(parent: ThreadContext): ThreadContext {
  const childIds = parent.childThreadIds ?? [];
  expect(childIds).toHaveLength(1);
  const child = (parent.childThreads ?? {})[childIds[0]!];
  if (!child) throw new Error("expected one child thread");
  return child;
}

// ───────────────────────────── Scenario A (move) ──────────────────────────────

describe("[B6] plan_window share — Scenario A: move 模式完整闭环", () => {
  it("父建 plan → move 给子 → 子改 + expand → 归还 → 父见进度", async () => {
    // 1. setup: 父 thread
    const parent = makeThread({ id: "_test_thinkable_b6_a_parent" });

    // 2. 父 exec(plan)
    await execRootMethod("plan", {
      thread: parent,
      args: { plan: "重构 thinkable 维度" },
    });
    const rootPlan = (parent.contextWindows ?? []).find(
      (w) => w.type === "plan",
    ) as PlanWindow | undefined;
    expect(rootPlan).toBeDefined();
    const PW1 = rootPlan!.id;

    // 3-5. 父侧 add 3 step
    await execOnPlanWindow(parent, PW1, "add_step", { text: "拆解 thinkloop" });
    await execOnPlanWindow(parent, PW1, "add_step", { text: "梳理 context" });
    await execOnPlanWindow(parent, PW1, "add_step", { text: "重写 builder" });
    const before = findPlanWindowById(parent, PW1)!;
    expect(before.steps).toHaveLength(3);
    const [s1, s2, s3] = before.steps;
    expect(s1).toBeDefined();
    expect(s2).toBeDefined();
    expect(s3).toBeDefined();

    // 6. 父 exec(do, share_windows=[{id:PW1, mode:move}])
    await execRootMethod("do", {
      thread: parent,
      args: {
        msg: "执行重构计划",
        share_windows: [{ window_id: PW1, mode: "move" }],
      },
    });

    // 7. 父侧验证：lent_out + 拒写
    const parentPlanAfterShare = findPlanWindowById(parent, PW1)!;
    expect(parentPlanAfterShare.sharing?.kind).toBe("lent_out");
    if (parentPlanAfterShare.sharing?.kind === "lent_out") {
      expect(parentPlanAfterShare.sharing.snapshot.id).toBe(PW1);
    }

    // 父侧再 add_step 应被守门拒绝（lent_out 上所有命令都拒）
    const parentMgr = WindowManager.fromThread(parent);
    await expect(
      parentMgr.openCommandExec({
        thread: parent,
        parentWindowId: PW1,
        command: "add_step",
        title: "[test] 父尝试改 lent_out",
        args: { text: "不应该成功" },
      }),
    ).rejects.toThrow(/已借出/);

    // 8. 切到子线程执行
    const child = getOnlyChild(parent);
    const childPlan = findPlanWindowById(child, PW1)!;
    expect(childPlan).toBeDefined();
    expect(childPlan.sharing).toBeUndefined(); // 子侧 owner，无 sharing
    expect(childPlan.steps).toHaveLength(3);

    // 子: update_step s1 = done
    const updErr1 = await execOnPlanWindow(child, PW1, "update_step", {
      step_id: s1!.id,
      status: "done",
    });
    expect(updErr1).toBeUndefined();
    // 子: update_step s2 = in-progress
    const updErr2 = await execOnPlanWindow(child, PW1, "update_step", {
      step_id: s2!.id,
      status: "in-progress",
    });
    expect(updErr2).toBeUndefined();
    // 子: expand_step s3 → 创建 sub plan PW2
    const expandRet = await execOnPlanWindow(child, PW1, "expand_step", {
      step_id: s3!.id,
      title: "子任务: 重写 builder",
      description: "替换 buildInputItems 调用栈",
    });
    expect(typeof expandRet).toBe("string");
    const childPlanAfterExpand = findPlanWindowById(child, PW1)!;
    const subId = childPlanAfterExpand.steps[2]!.subPlanWindowId;
    expect(typeof subId).toBe("string");
    const PW2 = subId!;
    // 子侧 sub plan 存在
    const childSub = findPlanWindowById(child, PW2)!;
    expect(childSub).toBeDefined();
    expect(childSub.parentPlanWindowId).toBe(PW1);
    expect(childSub.parentStepId).toBe(s3!.id);
    // 子: 在 sub plan 上 add_step
    await execOnPlanWindow(child, PW2, "add_step", { text: "替换 buildInputItems" });
    const childSubAfter = findPlanWindowById(child, PW2)!;
    expect(childSubAfter.steps).toHaveLength(1);

    // 9. 子归还 — 通过 creator do_window 调 move(window_id=PW1, mode=move)
    const childCreator = findChildCreatorDoWindow(child);
    const out = await dispatchToolCall(child, {
      id: "call_b6_a_return",
      name: "exec",
      arguments: {
        title: "[test] 归还 plan",
        window_id: childCreator.id,
        command: "move",
        args: { window_id: PW1, mode: "move" },
      },
    });
    const parsed = JSON.parse(out);
    expect(parsed.ok).toBe(true);

    // 10. 父侧验证：恢复 owner + 见到进度
    const parentPlanReturned = findPlanWindowById(parent, PW1)!;
    expect(parentPlanReturned).toBeDefined();
    expect(parentPlanReturned.sharing).toBeUndefined();
    expect(parentPlanReturned.steps).toHaveLength(3);
    expect(parentPlanReturned.steps[0]!.status).toBe("done");
    expect(parentPlanReturned.steps[1]!.status).toBe("in-progress");
    expect(parentPlanReturned.steps[2]!.subPlanWindowId).toBe(PW2);

    // sub plan 是否回流到父：现实记录（design §3.6 没明说）
    // do_window.move 的归还路径只按 window_id 精确匹配（无 cascade），
    // sub plan 留在子；父侧不会看到 PW2 这个 plan_window。
    const parentSub = findPlanWindowById(parent, PW2);
    const childSubStill = findPlanWindowById(child, PW2);
    // 断言现实：sub plan 留子；不在父
    expect(parentSub).toBeUndefined();
    expect(childSubStill).toBeDefined();
    expect(childSubStill?.parentPlanWindowId).toBe(PW1);
  });
});

// ───────────────────────────── Scenario B (ref) ───────────────────────────────

describe("[B6] plan_window share — Scenario B: ref 模式（子只读）", () => {
  it("父建 plan → share ref 给子 → 子改被拒 → 子 close 不影响父", async () => {
    const parent = makeThread({ id: "_test_thinkable_b6_b_parent" });
    await execRootMethod("plan", {
      thread: parent,
      args: { plan: "为 v2 做准备" },
    });
    const rootPlan = (parent.contextWindows ?? []).find(
      (w) => w.type === "plan",
    ) as PlanWindow;
    const PW1 = rootPlan.id;
    await execOnPlanWindow(parent, PW1, "add_step", { text: "step a" });
    await execOnPlanWindow(parent, PW1, "add_step", { text: "step b" });
    await execOnPlanWindow(parent, PW1, "add_step", { text: "step c" });
    const stepsBefore = findPlanWindowById(parent, PW1)!.steps.map((x) => x.id);

    await execRootMethod("do", {
      thread: parent,
      args: {
        msg: "看父 plan",
        share_windows: [{ window_id: PW1, mode: "ref" }],
      },
    });

    // 父侧仍 owner（无 sharing；ref 模式不影响父侧 sharing 字段）
    const parentSide = findPlanWindowById(parent, PW1)!;
    expect(parentSide.sharing).toBeUndefined();

    const child = getOnlyChild(parent);
    const childSide = findPlanWindowById(child, PW1)!;
    expect(childSide.sharing?.kind).toBe("ref");

    // 子在 ref 上尝试 update_step → 拒绝（守门：ref 上仅 close 允许）
    const childMgr = WindowManager.fromThread(child);
    await expect(
      childMgr.openCommandExec({
        thread: child,
        parentWindowId: PW1,
        command: "update_step",
        title: "[test] 子尝试改 ref",
        args: { step_id: stepsBefore[0]!, status: "done" },
      }),
    ).rejects.toThrow(/只读 ref/);

    // 子 close ref（只释放本地）
    const closeMgr = WindowManager.fromThread(child);
    await closeMgr.openCommandExec({
      thread: child,
      parentWindowId: PW1,
      command: "close",
      title: "[test] release ref",
    });
    // close 后通过 mgr.close 释放本地 ref；这里 close command 在 plan_window 上注册了；
    // 但 ref 的"close 释放本地引用"是 mgr 守门特例 — 真实释放路径靠 mgr.close()，
    // 这里只验证调用未抛错 / 调用未污染父侧。
    // 父侧 PW1 仍是 owner；steps 不变。
    const parentAfter = findPlanWindowById(parent, PW1)!;
    expect(parentAfter.sharing).toBeUndefined();
    expect(parentAfter.steps).toHaveLength(3);
    expect(parentAfter.steps.every((s) => s.status === "pending")).toBe(true);
  });
});

// ───────────────────────────── Scenario C (边界) ──────────────────────────────

describe("[B6] plan_window share — Scenario C: 边界 / 错误路径", () => {
  it("root + sub plan_window 都能被 share（都是 plan 类型实例）", async () => {
    const parent = makeThread({ id: "_test_thinkable_b6_c_parent" });
    await execRootMethod("plan", { thread: parent, args: { plan: "p" } });
    const rootPlan = (parent.contextWindows ?? []).find(
      (w) => w.type === "plan",
    ) as PlanWindow;
    const PW1 = rootPlan.id;
    await execOnPlanWindow(parent, PW1, "add_step", { text: "x" });
    const stepId = findPlanWindowById(parent, PW1)!.steps[0]!.id;
    await execOnPlanWindow(parent, PW1, "expand_step", { step_id: stepId });
    const subId = findPlanWindowById(parent, PW1)!.steps[0]!.subPlanWindowId!;

    // 直接 share sub plan_window 给子线程（不带 root plan）
    await execRootMethod("do", {
      thread: parent,
      args: {
        msg: "只看子 plan",
        share_windows: [{ window_id: subId, mode: "ref" }],
      },
    });
    const child = getOnlyChild(parent);
    const childRef = findPlanWindowById(child, subId);
    expect(childRef).toBeDefined();
    expect(childRef!.sharing?.kind).toBe("ref");
    // 父侧 sub plan 不变
    const parentSub = findPlanWindowById(parent, subId)!;
    expect(parentSub.sharing).toBeUndefined();
  });

  it("已 lent_out 的 plan_window 再 share 给同一子被拒（do_window.move 守门）", async () => {
    const parent = makeThread({ id: "_test_thinkable_b6_c_dup" });
    await execRootMethod("plan", { thread: parent, args: { plan: "p" } });
    const PW1 = ((parent.contextWindows ?? []).find(
      (w) => w.type === "plan",
    ) as PlanWindow).id;

    await execRootMethod("do", {
      thread: parent,
      args: {
        msg: "first share",
        share_windows: [{ window_id: PW1, mode: "move" }],
      },
    });
    // 父侧已是 lent_out;通过父 do_window.move 再 share 应被拒（sharing 已设置)
    const parentDo = findParentSideDoWindow(parent);
    const out = await dispatchToolCall(parent, {
      id: "call_b6_c_dup",
      name: "exec",
      arguments: {
        title: "[test] 重复 share",
        window_id: parentDo.id,
        command: "move",
        args: { window_id: PW1, mode: "move" },
      },
    });
    const parsed = JSON.parse(out);
    // 由于 plan 已 sharing=lent_out → move 命令应当返回错误（move 自身做 sharing 状态校验）
    // 注意：dispatchToolCall 的成功语义是工具调用本身完成；
    // command.exec 返回的错误字符串会被作为 result 串到 ok=true 的响应里
    // 实际行为以现状记录：result 含 "已借出" / "当前是" 错误信息
    expect(parsed.ok).toBe(true);
    const resultText = JSON.stringify(parsed);
    const looksRejected =
      resultText.includes("已借出") ||
      resultText.includes("当前是") ||
      resultText.includes("已是 sharing");
    expect(looksRejected).toBe(true);
  });

  it("mode=move 后强 archive 父 do_window → cascade 自动归还", async () => {
    const parent = makeThread({ id: "_test_thinkable_b6_c_cascade" });
    await execRootMethod("plan", { thread: parent, args: { plan: "p" } });
    const PW1 = ((parent.contextWindows ?? []).find(
      (w) => w.type === "plan",
    ) as PlanWindow).id;
    await execOnPlanWindow(parent, PW1, "add_step", { text: "first" });

    await execRootMethod("do", {
      thread: parent,
      args: {
        msg: "拿去做",
        share_windows: [{ window_id: PW1, mode: "move" }],
      },
    });
    const child = getOnlyChild(parent);
    // 子在 plan 上加一步，证明 latest 在子侧
    await execOnPlanWindow(child, PW1, "add_step", { text: "child added" });
    expect(findPlanWindowById(child, PW1)!.steps).toHaveLength(2);

    // 父侧 lent_out
    expect(findPlanWindowById(parent, PW1)!.sharing?.kind).toBe("lent_out");

    // 父调 archiveDoWindowChild 强行 archive 子 do_window → 触发自动归还
    const parentDo = findParentSideDoWindow(parent);
    archiveDoWindowChild(parent, parentDo);

    // 父恢复 owner + 见到子的 latest（"child added"）
    const parentAfter = findPlanWindowById(parent, PW1)!;
    expect(parentAfter.sharing).toBeUndefined();
    expect(parentAfter.steps).toHaveLength(2);
    expect(parentAfter.steps[1]!.text).toBe("child added");
    // 子线程被切到 paused
    expect(child.status).toBe("paused");
  });
});

// silent type reference to keep ContextWindow import grounded
void (null as ContextWindow | null);
