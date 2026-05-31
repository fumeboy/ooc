/**
 * self-view do 切片单测（OOC-4 L6b）：
 * - renderActiveDoSlice：parent 视角看进行中的子线程（<active_children><child thread_id status>）。
 * - renderParentTaskSlice：child 视角看 parent 任务 + 回报口（<parent_task parent_thread_id hint>）。
 *
 * do_window 已 render-skip（见 src/thinkable/__tests__/context.test.ts 的 render-skip 用例）；
 * 本文件验证塌缩后 agent 经自视切片看到 children / parent，且空场景不渲染。
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
// side-effect: 触发 windows 注册（do method 等）
import "../../../executable/windows";
import { execRootMethod } from "../../../executable/windows";
import { renderActiveDoSlice, renderParentTaskSlice } from "../self-view";
import { serializeXml } from "../xml";
import { makeThread } from "../../../__tests__/make-thread";
import {
  createFlowObject,
  __resetSerialQueueForTests,
  type ThreadPersistenceRef,
} from "../../../persistable";

describe("[L6b] self-view do 切片 — active_children / parent_task", () => {
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

  async function setupParentWithChild() {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-l6b-selfview-"));
    await createFlowObject({ baseDir: tempRoot, sessionId: "s", objectId: "agent" });
    const parentRef: ThreadPersistenceRef = { baseDir: tempRoot, sessionId: "s", objectId: "agent", threadId: "root" };
    const parent = makeThread({ id: "root", persistence: parentRef });
    await execRootMethod("do", { thread: parent, args: { msg: "请处理告警" } });
    const childId = parent.childThreadIds![0]!;
    const child = parent.childThreads![childId]!;
    return { parent, child, childId };
  }

  it("parent: 有 running 子线程 → <active_children><child thread_id status> + transcript + hint", async () => {
    const { parent, childId } = await setupParentWithChild();
    const node = renderActiveDoSlice(parent);
    expect(node).not.toBeNull();
    const xml = serializeXml(node!);
    expect(xml).toContain("<active_children");
    expect(xml).toContain(`thread_id="${childId}"`);
    expect(xml).toContain('status="running"');
    expect(xml).toContain("do_continue(target=");
    expect(xml).toContain("do_close(target=");
    // 父 outbox 里的初始消息（父→子）渲为 outgoing transcript
    expect(xml).toContain("请处理告警");
    expect(xml).toContain('dir="outgoing"');
  });

  it("child: 有 creator do_window → <parent_task parent_thread_id hint> + transcript", async () => {
    const { child } = await setupParentWithChild();
    const node = renderParentTaskSlice(child);
    expect(node).not.toBeNull();
    const xml = serializeXml(node!);
    expect(xml).toContain("<parent_task");
    expect(xml).toContain('parent_thread_id="root"');
    expect(xml).toContain("向 parent 回报用 do_continue(target=");
    // child inbox 里的初始消息（父→子）在 child 视角渲为 incoming transcript
    expect(xml).toContain("请处理告警");
    expect(xml).toContain('dir="incoming"');
  });

  it("parent: 子线程已 do_close（paused）→ 不在 <active_children>（返回 null）", async () => {
    const { parent, childId } = await setupParentWithChild();
    await execRootMethod("do_close", { thread: parent, args: { target: childId } });
    const node = renderActiveDoSlice(parent);
    expect(node).toBeNull();
  });

  it("无 do_window（self-driven thread）→ 两切片都返回 null", () => {
    const lone = makeThread({ id: "lone", skipCreatorWindow: true });
    expect(renderActiveDoSlice(lone)).toBeNull();
    expect(renderParentTaskSlice(lone)).toBeNull();
  });
});
