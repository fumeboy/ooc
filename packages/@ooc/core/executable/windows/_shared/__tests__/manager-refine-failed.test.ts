/**
 * Round 13 G2 — manager.refine 支持 failed → open 复活路径单测。
 *
 * 验证 manager 状态机:
 * 1. open 状态 refine → 仍 open + args 累积
 * 2. failed 状态 refine → 自动切回 open + args 累积 + result 清空（核心: 复活路径）
 * 3. failed 状态 submit → 抛错（要求先 refine）
 * 4. executing 状态 refine → 返 false（不允许）
 *
 * 不测 success → refine: success 形态下 form 已自动从 contextWindows 移除,
 * mgr.get() 拿不到, 不会走到 refine 内部分支。
 */

import { describe, expect, it } from "bun:test";
import { WindowManager } from "../manager";
import { builtinRegistry } from "../registry";
import { makeThread } from "../../../../__tests__/make-thread";
import { dispatchToolCall } from "../../../tools";
import type { MethodExecWindow } from "../types";
import type { ThreadContext } from "../../../../thinkable/context";

/**
 * 通过 exec tool 创建一个 do form (缺 msg, 不会 auto-submit), submit 让它进 failed。
 * 返回 thread + formId, 供测试继续操作。
 */
async function makeFailedForm(): Promise<{ thread: ThreadContext; formId: string }> {
  const thread = makeThread({ id: "t_refine_failed" });
  // 1. open do form 不带 msg, 不会 auto-submit (do 需要 msg)
  await dispatchToolCall(thread, {
    id: "call_1",
    name: "exec",
    arguments: { title: "派生", method: "do", description: "fork" },
  });
  const form = thread.contextWindows.find(
    (w): w is MethodExecWindow => w.type === "method_exec",
  );
  if (!form) throw new Error("expected command_exec form created (do with no msg)");
  // 2. submit → 失败 (do 缺 msg → form 进 failed)
  await dispatchToolCall(thread, {
    id: "call_2",
    name: "exec",
    arguments: { title: "执行", window_id: form.id, method: "submit" },
  });
  return { thread, formId: form.id };
}

describe("Round 13 G2: manager.refine 支持 failed → open 复活", () => {
  it("open 状态 refine → 仍 open + args 累积", async () => {
    const thread = makeThread({ id: "t_open_refine" });
    await dispatchToolCall(thread, {
      id: "call_1",
      name: "exec",
      arguments: { title: "派生", method: "do", description: "fork" },
    });
    const form = thread.contextWindows.find(
      (w): w is MethodExecWindow => w.type === "method_exec",
    )!;
    expect(form.status).toBe("open");

    const mgr = WindowManager.fromThread(thread, builtinRegistry);
    const ok = mgr.refine(form.id, { msg: "hello" });
    expect(ok).toBe(true);

    const after = mgr.get(form.id) as MethodExecWindow;
    expect(after.status).toBe("open");
    expect(after.accumulatedArgs.msg).toBe("hello");
    expect(after.result).toBeUndefined();
  });

  it("failed 状态 refine → 自动切回 open + 累积 args + 清旧 result（复活路径）", async () => {
    const { thread, formId } = await makeFailedForm();
    const failed = thread.contextWindows.find(
      (w): w is MethodExecWindow => w.id === formId,
    );
    expect(failed?.status).toBe("failed");
    expect(failed?.result).toBeDefined();
    expect(failed?.result).toContain("[do] 缺少 msg");

    const mgr = WindowManager.fromThread(thread, builtinRegistry);
    const ok = mgr.refine(formId, { msg: "补齐的消息" });
    expect(ok).toBe(true);

    const revived = mgr.get(formId) as MethodExecWindow;
    expect(revived.status).toBe("open"); // 关键: failed → open
    expect(revived.accumulatedArgs.msg).toBe("补齐的消息"); // args 累积
    expect(revived.result).toBeUndefined(); // 旧 result 已清
  });

  it("failed 状态再 submit → manager.submit 抛错（要求先 refine 回 open）", async () => {
    const { thread, formId } = await makeFailedForm();
    const mgr = WindowManager.fromThread(thread, builtinRegistry);
    // 直接对 failed 的 form submit 应抛错（manager 内部要求 open）
    let threw = false;
    try {
      await mgr.submit(formId, thread);
    } catch (err) {
      threw = true;
      expect((err as Error).message).toContain('expected "open"');
    }
    expect(threw).toBe(true);
  });

  it("executing 状态 refine → 返 false（不允许）", async () => {
    const thread = makeThread({ id: "t_executing" });
    await dispatchToolCall(thread, {
      id: "call_1",
      name: "exec",
      arguments: { title: "派生", method: "do", description: "fork" },
    });
    const form = thread.contextWindows.find(
      (w): w is MethodExecWindow => w.type === "method_exec",
    )!;
    // 手工把 status 改成 executing 模拟中间态
    const mgr = WindowManager.fromThread(thread, builtinRegistry);
    mgr.upsertWindow({ ...form, status: "executing" });
    const ok = mgr.refine(form.id, { msg: "试图 refine executing" });
    expect(ok).toBe(false);
  });

  it("复活路径完整验证: failed → refine → open → submit → success → 自动移除", async () => {
    const { thread, formId } = await makeFailedForm();
    const mgr = WindowManager.fromThread(thread, builtinRegistry);
    mgr.refine(formId, { msg: "终于补齐了" });
    // 此时 form 已回 open, 可正常 submit
    const after = mgr.get(formId) as MethodExecWindow;
    expect(after.status).toBe("open");
    await mgr.submit(formId, thread);
    thread.contextWindows = mgr.toData();
    // do 成功 → form 自动从 contextWindows 移除 (success → 移除)
    expect(thread.contextWindows.find((w) => w.id === formId)).toBeUndefined();
  });
});
