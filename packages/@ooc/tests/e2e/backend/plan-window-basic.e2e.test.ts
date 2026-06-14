/**
 * plan_window — 基础闭环 e2e。
 *
 * 不真启 backend；用 execRootMethod + WindowManager 直接驱动 command 链：
 * 1. root.plan 创建 root plan_window
 * 2. plan_window.add_step
 * 3. plan_window.update_step
 * 4. plan_window.expand_step 创建 sub plan_window + 父 step.subPlanWindowId 回填
 * 5. plan_window.close cascade archive sub plan_window
 * 6. renderContextXml 渲染 plan_window 子节点
 * 7. plan_window 可被 share（基础 sharing 检查：进入 lent_out 状态）
 *
 * 测试自身的 session 卫生:
 *  - 内存 thread，无持久化、无 tmpdir
 *  - 无 long-running 进程
 */

import { describe, expect, it } from "bun:test";
// side-effect: 触发 windows 注册（含 plan）
import "@ooc/core/executable/windows";
import { execRootMethod, WindowManager, builtinRegistry } from "@ooc/core/executable/windows";
import { renderContextXml } from "@ooc/core/__tests__/render-context-xml";
import { makeThread } from "@ooc/core/__tests__/make-thread";
import type {
  ContextWindow,
  PlanWindow,
  PlanWindowStep,
} from "@ooc/core/executable/windows/_shared/types";
import type { ThreadContext } from "@ooc/core/thinkable/context";

// ─────────────────────────── helpers ──────────────────────────────────────────

function findPlanWindow(thread: ThreadContext): PlanWindow {
  const w = (thread.contextWindows ?? []).find((x) => x.class === "plan");
  if (!w || w.class !== "plan") throw new Error("expected plan_window in thread");
  return w as PlanWindow;
}

function findPlanWindowById(thread: ThreadContext, id: string): PlanWindow | undefined {
  const w = (thread.contextWindows ?? []).find((x) => x.id === id);
  return w && w.class === "plan" ? (w as PlanWindow) : undefined;
}

/** 模拟 manager.openMethodExec 流程的极简化：直接调 entry.exec，并模拟 manager 状态。 */
async function execOnWindow(
  thread: ThreadContext,
  parentWindowId: string,
  method: string,
  args: Record<string, unknown>,
): Promise<string | undefined> {
  const mgr = WindowManager.fromThread(thread, builtinRegistry);
  const result = await mgr.openMethodExec({
    thread,
    parentWindowId,
    method,
    title: `test ${method}`,
    args,
  });
  // 把 mgr 写回 thread（与 thinkloop 路径一致）
  thread.contextWindows = mgr.toData();
  return result.submitResult;
}

// ─────────────────────────── tests ────────────────────────────────────────────

describe("plan_window — basic闭环", () => {
  it("step 1-2: root.plan 创建 plan_window；add_step 追加 step", async () => {
    const thread = makeThread({ id: "t_plan_1" });
    const created = await execRootMethod("plan", {
      thread,
      args: { plan: "重构 thinkable" },
    });
    expect(typeof created).toBe("string");
    const plan = findPlanWindow(thread);
    expect(plan.title).toBe("Plan");
    expect(plan.description).toBe("重构 thinkable");
    expect(plan.steps).toHaveLength(0);
    expect(plan.status).toBe("active");

    // root.plan 不再做 update 幂等——每次调用都新建一个
    // plan_window（in-place 更新改走 exec(<plan_window_id>, "update_plan", ...)）。
    await execRootMethod("plan", {
      thread,
      args: { title: "Refactored Plan", description: "go!" },
    });
    const plans = thread.contextWindows.filter((w) => w.class === "plan");
    expect(plans).toHaveLength(2);
    const secondPlan = plans.find((p) => (p as PlanWindow).title === "Refactored Plan") as PlanWindow;
    expect(secondPlan).toBeDefined();
    expect(secondPlan.description).toBe("go!");

    // add_step（作用在第一个 plan 上，验证 step 操作仍可定位到具体 plan_window）
    await execOnWindow(thread, plan.id, "add_step", { text: "step1: design" });
    const plan2 = findPlanWindowById(thread, plan.id)!;
    expect(plan2.steps).toHaveLength(1);
    expect(plan2.steps[0]!.text).toBe("step1: design");
    expect(plan2.steps[0]!.status).toBe("pending");
  });

  it("step 3: update_step 切 status=done", async () => {
    const thread = makeThread({ id: "t_plan_2" });
    await execRootMethod("plan", { thread, args: { plan: "p" } });
    const plan = findPlanWindow(thread);
    await execOnWindow(thread, plan.id, "add_step", { text: "做 A" });
    const stepId = findPlanWindow(thread).steps[0]!.id;

    await execOnWindow(thread, plan.id, "update_step", { step_id: stepId, status: "done" });
    const planAfter = findPlanWindow(thread);
    expect(planAfter.steps[0]!.status).toBe("done");
  });

  it("step 4: expand_step 创建 sub plan_window + 父 step.subPlanWindowId 回填", async () => {
    const thread = makeThread({ id: "t_plan_3" });
    await execRootMethod("plan", { thread, args: { plan: "parent plan" } });
    const parent = findPlanWindow(thread);
    await execOnWindow(thread, parent.id, "add_step", { text: "do sub work" });
    const stepId = findPlanWindow(thread).steps[0]!.id;

    await execOnWindow(thread, parent.id, "expand_step", { step_id: stepId, description: "child detail" });
    const parentAfter = findPlanWindow(thread);
    const subId = parentAfter.steps[0]!.subPlanWindowId;
    expect(typeof subId).toBe("string");
    expect(subId!.length).toBeGreaterThan(0);

    const sub = findPlanWindowById(thread, subId!);
    expect(sub).toBeDefined();
    expect(sub!.parentPlanWindowId).toBe(parent.id);
    expect(sub!.parentStepId).toBe(stepId);
    expect(sub!.description).toBe("child detail");
    expect(sub!.status).toBe("active");

    // 不允许重复 expand 同一 step
    const dupErr = await execOnWindow(thread, parent.id, "expand_step", { step_id: stepId });
    expect(typeof dupErr === "string" && dupErr.includes("已经展开")).toBe(true);
  });

  it("step 5: collapse_subplan archive sub plan + 清父 step.subPlanWindowId", async () => {
    const thread = makeThread({ id: "t_plan_4" });
    await execRootMethod("plan", { thread, args: { plan: "p" } });
    const parent = findPlanWindow(thread);
    await execOnWindow(thread, parent.id, "add_step", { text: "x" });
    const stepId = findPlanWindow(thread).steps[0]!.id;
    await execOnWindow(thread, parent.id, "expand_step", { step_id: stepId });
    const subId = findPlanWindow(thread).steps[0]!.subPlanWindowId!;

    await execOnWindow(thread, parent.id, "collapse_subplan", { step_id: stepId });
    const planAfter = findPlanWindow(thread);
    expect(planAfter.steps[0]!.subPlanWindowId).toBeUndefined();
    const sub = findPlanWindowById(thread, subId);
    expect(sub?.status).toBe("archived");
  });

  it("step 6: close plan_window cascade archive sub plan_window", async () => {
    const thread = makeThread({ id: "t_plan_5" });
    await execRootMethod("plan", { thread, args: { plan: "p" } });
    const parent = findPlanWindow(thread);
    await execOnWindow(thread, parent.id, "add_step", { text: "x" });
    const stepId = findPlanWindow(thread).steps[0]!.id;
    await execOnWindow(thread, parent.id, "expand_step", { step_id: stepId });
    const subId = findPlanWindow(thread).steps[0]!.subPlanWindowId!;

    // 通过 mgr.close 触发 onClose hook（plan close cascade 把 sub archive）
    const mgr = WindowManager.fromThread(thread, builtinRegistry);
    mgr.close(parent.id, thread);
    thread.contextWindows = mgr.toData();

    // root plan_window 已 remove；sub plan_window 仍存在但 status=archived
    const planRemoved = thread.contextWindows.find((w) => w.id === parent.id);
    expect(planRemoved).toBeUndefined();
    const sub = findPlanWindowById(thread, subId);
    expect(sub?.status).toBe("archived");
  });

  it("step 7: renderContextXml 渲染 plan_window 含正确 steps 树", async () => {
    const thread = makeThread({ id: "t_plan_6" });
    await execRootMethod("plan", {
      thread,
      args: { title: "P", description: "desc", steps: [{ text: "a" }, { text: "b" }] },
    });
    const plan = findPlanWindow(thread);
    expect(plan.steps).toHaveLength(2);

    const xml = await renderContextXml({
      thread,
      contextWindows: thread.contextWindows,
    });
    expect(xml).toContain('class="plan"');
    expect(xml).toContain("<title>P</title>");
    expect(xml).toContain("<description>desc</description>");
    expect(xml).toContain('<steps count="2">');
    expect(xml).toContain('status="pending"');
    // commands 元数据节点
    expect(xml).toContain('name="add_step"');
    expect(xml).toContain('name="expand_step"');
  });

  it("step 8 (share): plan_window 通过 talk_window.share(move) 进入 mutable-ref shadow 状态", async () => {
    // 父 thread 创建 plan_window，再用 talk(target=自己) fork 子并 share plan_window (mode=move)
    const parent = makeThread({
      id: "t_plan_share_parent",
      persistence: { baseDir: "/tmp/__test__", sessionId: "s_test", objectId: "alice", threadId: "t_plan_share_parent" },
    });
    await execRootMethod("plan", { thread: parent, args: { plan: "shareable" } });
    const plan = findPlanWindow(parent);

    await execRootMethod("talk", {
      thread: parent,
      args: {
        target: "alice",
        msg: "go work on plan",
        share_windows: [{ window_id: plan.id, mode: "move" }],
      },
    });

    // 父侧 plan_window 现在应为 mutable-ref shadow
    const parentPlan = parent.contextWindows.find((w) => w.id === plan.id);
    expect(parentPlan?.sharing?.kind).toBe("mutable-ref");

    // 子侧应有完整 owner plan_window（无 sharing 字段）
    const childId = (parent.childThreadIds ?? [])[0]!;
    const child = (parent.childThreads ?? {})[childId]!;
    const childPlan = (child.contextWindows ?? []).find((w) => w.id === plan.id);
    expect(childPlan).toBeDefined();
    expect(childPlan?.sharing).toBeUndefined();
    expect(childPlan?.class).toBe("plan");
  });
});

// ─────────────────────────── 配套：compressView 验证 ──────────────

describe("plan_window — compressView", () => {
  it("level 1: title + status + step count + done/total ratio", async () => {
    const thread = makeThread({ id: "t_plan_compress_1" });
    await execRootMethod("plan", {
      thread,
      args: {
        title: "P",
        steps: [
          { text: "a", status: "done" },
          { text: "b" },
          { text: "c" },
        ],
      },
    });
    const plan = findPlanWindow(thread);
    // 模拟压缩态
    const compressedAll: ContextWindow[] = (thread.contextWindows as ContextWindow[]).map((w) =>
      w.id === plan.id ? { ...w, compressLevel: 1 as const } : w,
    );
    const xml = await renderContextXml({ thread, contextWindows: compressedAll });
    expect(xml).toContain('done_ratio="1/3"');
    expect(xml).toContain('step_count="3"');
    expect(xml).toContain('level="1"');
  });

  it("level 2: title + status only", async () => {
    const thread = makeThread({ id: "t_plan_compress_2" });
    await execRootMethod("plan", { thread, args: { plan: "p" } });
    const plan = findPlanWindow(thread);
    const compressedAll: ContextWindow[] = (thread.contextWindows as ContextWindow[]).map((w) =>
      w.id === plan.id ? { ...w, compressLevel: 2 as const } : w,
    );
    const xml = await renderContextXml({ thread, contextWindows: compressedAll });
    expect(xml).toContain('level="2"');
    // level 2 不应有 step_count / done_ratio
    expect(xml).not.toContain("done_ratio");
  });
});

// silent reference to avoid unused import
void (null as PlanWindowStep | null);
