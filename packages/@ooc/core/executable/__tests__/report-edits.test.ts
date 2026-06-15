/**
 * reportStateEdit / reportContextEdit + dispatch wiring.
 *
 * 验证：
 * 1. reportStateEdit(ref) on a non-builtin (plan) flow object → state.json 反映内存里的最新状态
 * 2. reportStateEdit(ref) on a builtin feature (method_exec form) → 是 no-op；state.json 不存在
 * 3. reportContextEdit(thread) → thread-context.json 反映当前 contextWindows
 * 4. dispatch wiring: 通过 exec→openMethodExec(refine, args=...) auto-submit refine 后，
 *    thread-context.json 中对应 form 项的 accumulatedArgs 已含 refine 的新参数
 *    （证明 manager.submit 注入的 ctx.reportContextEdit() 被 refine.ts 内部调用）
 */

import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WindowManager } from "../manager";
import { builtinRegistry } from "../registry";
import { makeThread } from "../../../../__tests__/make-thread";
import { ROOT_WINDOW_ID } from "../types";
import type { MethodExecWindow } from "../types";
import type { PlanWindow } from "@ooc/builtins/agent/plan/types.js";
import {
  runtimeObjectStateFile,
  threadContextFile,
  readThreadContext,
  __resetSerialQueueForTests,
} from "../../../../persistable";
import type { FlowObjectRef, ThreadPersistenceRef } from "../../../../persistable/common";
import type { ThreadContext } from "../../../../thinkable/context";
import type { ContextWindow } from "../types";
import { dispatchToolCall } from "../../../tools";

/**
 * agency 方法（do/...）已从 root 迁到 `_builtin/agent` 类。
 * 经 dispatch/exec 调 agency 时须把目标窗指向一个 class 解析得到 `_builtin/agent` 的窗。
 */
const AGENT_WIN = {
  id: "agent",
  class: "_builtin/agent",
  parentWindowId: ROOT_WINDOW_ID,
  title: "agent",
  status: "open",
  createdAt: Date.now(),
  isMemberWindow: true,
  // class="_builtin/agent" 是继承类、非 ContextWindow union discriminant → 经 unknown 转。
} as unknown as ContextWindow;

async function exists(file: string): Promise<boolean> {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}

function makePlan(id: string, title: string, description: string): PlanWindow {
  return {
    id,
    class: "plan",
    parentWindowId: ROOT_WINDOW_ID,
    title,
    status: "active",
    createdAt: 1717000000000,
    description,
    steps: [],
  } as PlanWindow;
}

describe("reportStateEdit / reportContextEdit + dispatch wiring", () => {
  let baseDir: string;
  let persistence: ThreadPersistenceRef;
  let thread: ThreadContext;

  beforeEach(async () => {
    __resetSerialQueueForTests();
    baseDir = await mkdtemp(join(tmpdir(), "ooc-p6-report-"));
    persistence = {
      baseDir,
      sessionId: "sess_p6_8",
      objectId: "agent_x",
      threadId: "t_main",
    };
    thread = makeThread({ id: "t_main", persistence, skipCreatorWindow: true, extraWindows: [AGENT_WIN] });
  });

  afterEach(async () => {
    await rm(baseDir, { recursive: true, force: true });
  });

  it("Test 1: reportStateEdit(ref) on plan (non-builtin) → state.json reflects in-memory state", async () => {
    const mgr = WindowManager.fromThread(thread, builtinRegistry);
    const plan = makePlan("plan_r1", "demo", "initial content");
    mgr.insertTypedWindow(plan, thread);

    const stateFile = runtimeObjectStateFile({
      baseDir,
      sessionId: "sess_p6_8",
      objectId: "plan_r1",
    });
    // wait for initial flush from insertTypedWindow
    for (let i = 0; i < 30; i++) {
      if (await exists(stateFile)) break;
      await Bun.sleep(20);
    }
    expect(await exists(stateFile)).toBe(true);

    // Mutate via upsertWindow to change in-memory plan content
    const updatedPlan: PlanWindow = { ...plan, description: "updated by reportStateEdit" };
    // Simulate: in-memory mutation without going through manager.upsertWindow's persistence —
    // directly poke the manager's window map by upsertWindow then re-flush via reportStateEdit.
    mgr.upsertWindow(updatedPlan);
    const ref: FlowObjectRef = {
      baseDir,
      sessionId: "sess_p6_8",
      objectId: "plan_r1",
    };
    await mgr.reportStateEdit(ref);

    const raw = await readFile(stateFile, "utf8");
    const parsed = JSON.parse(raw);
    expect(parsed.description).toBe("updated by reportStateEdit");
    // state.json 不应含 contextWindows 字段
    expect("contextWindows" in parsed).toBe(false);
  });

  it("Test 2: reportStateEdit(ref) on builtin feature (method_exec form) → no-op, no state.json", async () => {
    const mgr = WindowManager.fromThread(thread, builtinRegistry);
    // open a real form via openMethodExec (parent=agent, method=talk fork; not auto-submit because no args.msg)
    await mgr.openMethodExec({
      thread,
      parentWindowId: "agent",
      method: "talk",
      title: "派生",
      description: "fork",
      args: { target: "agent_x" },
    });
    const form = thread.contextWindows.find(
      (w): w is MethodExecWindow => w.class === "method_exec",
    );
    // openMethodExec returns formId via the result; but mgr.toData() reflects the in-memory map.
    // Use mgr's snapshot directly:
    thread.contextWindows = mgr.toData();
    const liveForm = mgr.toData().find(
      (w): w is MethodExecWindow => w.class === "method_exec",
    )!;

    const stateFile = runtimeObjectStateFile({
      baseDir,
      sessionId: "sess_p6_8",
      objectId: liveForm.id,
    });
    // give any pending flushes a chance (but there should be none for the form's own state.json
    // because method_exec is a builtin feature)
    await Bun.sleep(80);

    // reportStateEdit on the form's ref → no-op
    await mgr.reportStateEdit({
      baseDir,
      sessionId: "sess_p6_8",
      objectId: liveForm.id,
    });
    await Bun.sleep(40);

    expect(await exists(stateFile)).toBe(false);
    // unused variable to silence linter (if any) — keep `form` reference for clarity above
    void form;
  });

  it("Test 3: reportContextEdit(thread) → thread-context.json reflects current contextWindows", async () => {
    const mgr = WindowManager.fromThread(thread, builtinRegistry);
    const plan = makePlan("plan_r3", "demo3", "for context flush");
    mgr.insertTypedWindow(plan, thread);

    const tcFile = threadContextFile(persistence);
    for (let i = 0; i < 30; i++) {
      if (await exists(tcFile)) break;
      await Bun.sleep(20);
    }
    expect(await exists(tcFile)).toBe(true);

    // Now explicitly call reportContextEdit; it should rewrite thread-context.json
    // with the latest in-memory contextWindows (still the plan ref).
    await mgr.reportContextEdit(thread);
    const file = await readThreadContext(persistence);
    expect(file).not.toBeNull();
    expect(file!.threadId).toBe("t_main");
    // independent flow object (plan) should appear as a ref entry
    const ref = file!.contextWindows.find((e) => e.id === "plan_r3");
    expect(ref).toBeDefined();
    expect((ref as { _ref?: boolean })._ref).toBe(true);
  });

  it("Test 4: refine via dispatch updates thread-context.json without explicit caller flush", async () => {
    // Create a talk fork form (target=self, no msg → not auto-submit, stays open)
    await dispatchToolCall(thread, {
      id: "call_1",
      name: "exec",
      arguments: { title: "派生", window_id: "agent", method: "talk", description: "fork", args: { target: "agent_x" } },
    });
    const form = thread.contextWindows.find(
      (w): w is MethodExecWindow => w.class === "method_exec",
    );
    expect(form).toBeDefined();
    expect(form!.status).toBe("open");
    const formId = form!.id;

    // Wait for initial thread-context.json from openMethodExec persistence
    const tcFile = threadContextFile(persistence);
    for (let i = 0; i < 30; i++) {
      if (await exists(tcFile)) break;
      await Bun.sleep(20);
    }

    // Now refine the form: this dispatches refine.ts which internally calls
    // ctx.manager.refine(...) followed by ctx.reportContextEdit?.() — the wired-in helper.
    // 用 wait（不补齐 msg）refine：form 保持 open 不触发自动 submit，便于断言持久化内容。
    await dispatchToolCall(thread, {
      id: "call_2",
      name: "exec",
      arguments: {
        title: "累积",
        window_id: formId,
        method: "refine",
        args: { wait: true },
      },
    });
    // Allow the serial queue to flush.
    for (let i = 0; i < 30; i++) {
      const f = await readThreadContext(persistence);
      const entry = f?.contextWindows.find((e) => e.id === formId) as
        | MethodExecWindow
        | undefined;
      if (entry?.accumulatedArgs?.wait === true) break;
      await Bun.sleep(20);
    }

    const f = await readThreadContext(persistence);
    expect(f).not.toBeNull();
    const entry = f!.contextWindows.find((e) => e.id === formId) as
      | MethodExecWindow
      | undefined;
    expect(entry).toBeDefined();
    expect(entry!.class).toBe("method_exec");
    expect(entry!.accumulatedArgs).toMatchObject({ wait: true });
  });
});
