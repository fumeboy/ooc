/**
 * plan 跨 thread 共享 — object-scoped 自动满足（OOC-4 L5b；取代旧 plan_window share_windows）。
 *
 * Spec: docs/superpowers/plans/2026-05-31-ooc-4-L5b-plan-collapse.md §D1
 *
 * 旧实现（已删）：plan_window 是 thread.contextWindows 里的 ContextWindow，跨 thread 协作靠
 * do(share_windows=[{window_id, mode: move|ref}]) 把 plan_window 借给子 thread（lent_out / ref
 * 配对 + 归还）。本测试的 Scenario A/B/C 全部基于该机制，MVP 扁平塌缩后整体删除。
 *
 * 新语义：plan 塌缩为 owner flow 文件 plan.md，**object-scoped**——同一对象在本 session 下的
 * 所有 thread（root + child do threads，因 deriveChildPersistence 共享 objectId）自视都渲染
 * 同一份 plan.md。子 thread 无需任何显式 share 即可看到父对象的 plan，且子改 plan_set 父也看得到
 * （同一文件）。本测试直接证明：child do-thread 共享 parent objectId → renderSelfView 渲同一 <plan>。
 *
 * 测试自身的 session 卫生：tmpdir flow object；无 long-running 进程。
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

describe("[L5b] plan object-scoped 共享 — 取代 plan_window share_windows", () => {
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

  /** 同一 object（objectId="agent"）下两条 thread：parent(root) + child(do fork)，共享 objectId。 */
  async function setup() {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-e2e-plan-share-"));
    await createFlowObject({ baseDir: tempRoot, sessionId: "s", objectId: "agent" });
    const parentRef: ThreadPersistenceRef = { baseDir: tempRoot, sessionId: "s", objectId: "agent", threadId: "root" };
    // child do thread：threadId 不同，objectId 相同（deriveChildPersistence 共享对象）
    const childRef: ThreadPersistenceRef = { baseDir: tempRoot, sessionId: "s", objectId: "agent", threadId: "child_do" };
    return {
      parent: makeThread({ id: "root", persistence: parentRef }),
      child: makeThread({ id: "child_do", persistence: childRef }),
      childRef,
    };
  }

  it("父 plan_set → child do-thread 的 renderSelfView 渲染同一 <plan>（object-scoped，无需 share_windows）", async () => {
    const { parent, child } = await setup();

    // 父在 root thread 上设置对象级 plan
    await execRootMethod("plan_set", {
      thread: parent,
      args: { content: "# 重构 thinkable 维度\n\n- [ ] 拆解 thinkloop\n- [ ] 梳理 context" },
    });

    // 子 do-thread（共享 objectId）自视应渲染同一份 plan——不需要任何 share 操作
    const childNode = await renderSelfView(child);
    expect(childNode).not.toBeNull();
    const childXml = serializeXml(childNode!);
    expect(childXml).toContain("<self_view>");
    expect(childXml).toContain("<plan>");
    expect(childXml).toContain("拆解 thinkloop");
  });

  it("子 plan_set 改 plan → 父侧 renderSelfView 看到子的最新内容（同一对象文件，进度自动回流）", async () => {
    const { parent, child, childRef } = await setup();

    await execRootMethod("plan_set", { thread: parent, args: { content: "- [ ] 父建初稿" } });

    // 子推进计划：把某步标记完成 + 加新步骤（plan_set 覆盖语义，自管 checklist）
    await execRootMethod("plan_set", {
      thread: child,
      args: { content: "- [x] 父建初稿\n- [ ] 子追加的步骤" },
    });

    // 同一对象文件 → 父侧自视看到子改动后的最新内容（无显式归还，object-scoped 自动）
    const parentNode = await renderSelfView(parent);
    const parentXml = serializeXml(parentNode!);
    expect(parentXml).toContain("子追加的步骤");
    expect(parentXml).toContain("[x] 父建初稿");

    // 落盘也确认是同一份 plan.md（child 与 parent 共享 objectId）
    expect(await readPlan(childRef)).toContain("子追加的步骤");
  });

  it("父 plan_clear 后，子 do-thread 自视也不再渲染 plan（共享空文件）", async () => {
    const { parent, child } = await setup();
    await execRootMethod("plan_set", { thread: parent, args: { content: "- [ ] step" } });
    await execRootMethod("plan_clear", { thread: parent, args: {} });

    const childNode = await renderSelfView(child);
    // 无 plan + 无 todo → self_view 整体为空
    expect(childNode).toBeNull();
  });
});
