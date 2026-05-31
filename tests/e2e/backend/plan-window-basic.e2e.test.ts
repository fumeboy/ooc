/**
 * plan 塌缩 — 基础闭环 e2e（OOC-4 L5b；取代旧 plan_window 基础闭环）。
 *
 * Spec: docs/superpowers/plans/2026-05-31-ooc-4-L5b-plan-collapse.md
 * Meta: meta/object.doc.ts:executable.children.method_window（plan_set / plan_clear）
 *
 * 旧 plan_window（add_step / update_step / expand_step / collapse_subplan / mark_done /
 * close / compressView）在 MVP 扁平塌缩下全部删除：plan 现在是 owner flow 文件 plan.md，
 * LLM 用 markdown checklist（- [ ] / - [x]）自管步骤，无结构化 step / sub-plan / 压缩态。
 *
 * 不真启 backend；用 execRootMethod 直驱 plan_set / plan_clear，落盘到对象级 plan.md，
 * 再经 renderSelfView 验证 <self_view><plan> 自视切片。
 *
 * 测试自身的 session 卫生：
 *  - tmpdir flow object；无 long-running 进程
 */

import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
// side-effect: 触发 windows 注册
import "@src/executable/windows";
import { execRootMethod } from "@src/executable/windows";
import { renderSelfView } from "@src/thinkable/context/self-view";
import { serializeXml } from "@src/thinkable/context/xml";
import { makeThread } from "@src/__tests__/make-thread";
import {
  createFlowObject,
  readPlan,
  __resetSerialQueueForTests,
  type ThreadPersistenceRef,
} from "@src/persistable";

describe("[L5b] plan 塌缩 — plan_set / plan_clear + 自视切片", () => {
  let tempRoot: string | undefined;

  beforeEach(() => {
    __resetSerialQueueForTests();
  });

  afterEach(async () => {
    if (tempRoot) {
      await rm(tempRoot, { recursive: true, force: true });
      tempRoot = undefined;
    }
  });

  async function makePersisted(threadId: string) {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-e2e-plan-"));
    await createFlowObject({ baseDir: tempRoot, sessionId: "s", objectId: "agent" });
    const ref: ThreadPersistenceRef = { baseDir: tempRoot, sessionId: "s", objectId: "agent", threadId };
    return { thread: makeThread({ id: threadId, persistence: ref }), ref };
  }

  it("plan_set 写 plan.md（markdown checklist）；不再产生任何 plan_window", async () => {
    const { thread, ref } = await makePersisted("t_plan_set");
    const result = await execRootMethod("plan_set", {
      thread,
      args: { content: "# 重构 thinkable\n\n- [ ] 拆解 thinkloop\n- [x] 读完旧实现" },
    });
    expect(typeof result).toBe("string");
    expect(await readPlan(ref)).toContain("拆解 thinkloop");
    // B 类塌缩：不再有 plan_window ContextWindow
    expect(thread.contextWindows.find((w) => (w as { type: string }).type === "plan")).toBeUndefined();
  });

  it("plan_set 是覆盖语义（再次 set 全量替换，不是 merge）", async () => {
    const { thread, ref } = await makePersisted("t_plan_overwrite");
    await execRootMethod("plan_set", { thread, args: { content: "- [ ] old step" } });
    await execRootMethod("plan_set", { thread, args: { content: "- [ ] new step" } });
    const md = await readPlan(ref);
    expect(md).toContain("new step");
    expect(md).not.toContain("old step");
  });

  it("plan_clear 清空 plan.md", async () => {
    const { thread, ref } = await makePersisted("t_plan_clear");
    await execRootMethod("plan_set", { thread, args: { content: "- [ ] something" } });
    await execRootMethod("plan_clear", { thread, args: {} });
    expect(await readPlan(ref)).toBe("");
  });

  it("renderSelfView 把非空 plan.md 渲成 <self_view><plan>；plan_clear 后不渲", async () => {
    const { thread } = await makePersisted("t_plan_selfview");
    await execRootMethod("plan_set", {
      thread,
      args: { content: "- [ ] step A\n- [x] step B" },
    });
    const node = await renderSelfView(thread);
    expect(node).not.toBeNull();
    const xml = serializeXml(node!);
    expect(xml).toContain("<self_view>");
    expect(xml).toContain("<plan>");
    expect(xml).toContain("step A");

    await execRootMethod("plan_clear", { thread, args: {} });
    const after = await renderSelfView(thread);
    // 无 plan 且无 todo → self_view 整体为空
    expect(after).toBeNull();
  });
});
