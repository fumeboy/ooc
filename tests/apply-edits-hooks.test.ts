/**
 * apply_edits → build_hooks 闭环测试（Phase 3）
 *
 * 覆盖：
 * - applyEditPlan 成功后按 change 顺序跑 runBuildHooks
 * - 多文件 change：每个 path 都被喂给 hook
 * - 任一 hook 失败记到 feedbackByThread，下一轮可查
 * - ok=false 时不跑 hooks（避免对无效状态的误伤）
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import {
  createEditPlan,
  applyEditPlan,
} from "../src/persistence/edit-plans";
import {
  __clearHooks,
  registerBuildHook,
  getBuildFeedback,
} from "../src/world/hooks";

let tmp: string;

beforeEach(async () => {
  __clearHooks();
  tmp = await mkdtemp(join(tmpdir(), "ooc-apply-hooks-"));
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
  __clearHooks();
});

describe("applyEditPlan 成功 → 跑 build hooks", () => {
  test("多文件 change：每个 path 被喂给 hook", async () => {
    const seen: string[] = [];
    registerBuildHook({
      name: "spy",
      match: () => true,
      run: async (p) => {
        seen.push(p);
        return { success: true, output: "" };
      },
    });

    const plan = await createEditPlan({
      rootDir: tmp,
      changes: [
        { kind: "write", path: "a.txt", newContent: "A" },
        { kind: "write", path: "b.txt", newContent: "B" },
      ],
    });
    const result = await applyEditPlan(plan, { threadId: "t_apply_1" });
    expect(result.ok).toBe(true);
    expect(result.applied).toBe(2);
    /* hook 按 change 顺序执行 */
    expect(seen).toEqual(["a.txt", "b.txt"]);
  });

  test("hook 失败 → feedback 落到该线程", async () => {
    registerBuildHook({
      name: "always-fail",
      match: (p) => p.endsWith(".txt"),
      run: async (p) => ({
        success: false,
        output: `boom on ${p}`,
        errors: [`bad: ${p}`],
      }),
    });

    const plan = await createEditPlan({
      rootDir: tmp,
      changes: [
        { kind: "write", path: "a.txt", newContent: "A" },
        { kind: "write", path: "b.txt", newContent: "B" },
      ],
    });
    const threadId = "t_apply_2";
    const result = await applyEditPlan(plan, { threadId });
    expect(result.ok).toBe(true);
    /* applyEditPlan 返回里带 buildFeedback */
    expect(result.buildFeedback).toBeDefined();
    expect(result.buildFeedback!.length).toBe(2);
    /* 而且能通过 getBuildFeedback 按 threadId 查到 */
    const fb = getBuildFeedback(threadId);
    expect(fb.length).toBe(2);
    expect(fb.map((f) => f.path).sort()).toEqual(["a.txt", "b.txt"]);
    expect(fb.every((f) => !f.success)).toBe(true);
  });

  test("apply 失败 → 不跑 hooks", async () => {
    let hookRan = 0;
    registerBuildHook({
      name: "spy",
      match: () => true,
      run: async () => {
        hookRan++;
        return { success: true, output: "" };
      },
    });

    /* 制造失败：edit 但目标文件不存在 */
    const plan = await createEditPlan({
      rootDir: tmp,
      changes: [
        { kind: "edit", path: "missing.txt", oldText: "x", newText: "y" },
      ],
    });
    const result = await applyEditPlan(plan, { threadId: "t_apply_3" });
    expect(result.ok).toBe(false);
    expect(hookRan).toBe(0);
    expect(result.buildFeedback).toBeUndefined();
  });

  test("无 threadId 时仍跑 hook，feedback 落 global bucket", async () => {
    const seen: string[] = [];
    registerBuildHook({
      name: "spy",
      match: () => true,
      run: async (p) => {
        seen.push(p);
        return { success: false, output: "x" };
      },
    });
    const plan = await createEditPlan({
      rootDir: tmp,
      changes: [{ kind: "write", path: "z.txt", newContent: "Z" }],
    });
    const result = await applyEditPlan(plan);
    expect(result.ok).toBe(true);
    expect(seen).toEqual(["z.txt"]);
    /* threadId 缺失：getBuildFeedback() 查 global */
    const fb = getBuildFeedback();
    expect(fb.length).toBe(1);
    expect(fb[0]!.path).toBe("z.txt");
  });
});
