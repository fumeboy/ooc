/**
 * wait tool 5 条 reject 分支 + 2 条 happy path 的单元测试。
 *
 * 参见 spec: docs/superpowers/specs/2026-05-17-wait-requires-dependency-design.md §3
 * 参见 plan: docs/superpowers/plans/2026-05-17-wait-requires-dependency.md Task 7
 */

import { describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handleWaitTool } from "../tools/wait";
import { makeThread } from "../../__tests__/make-thread";
import { createFlowObject, setTalkRoute } from "../../persistable";
import type { ThreadContext } from "../../thinkable/context";
import {
  generateWindowId,
  ROOT_WINDOW_ID,
  type DoWindow,
  type FileWindow,
  type TalkWindow,
} from "../windows/_shared/types";

function findCreatorDoWindow(thread: ThreadContext): DoWindow {
  const found = thread.contextWindows.find(
    (w): w is DoWindow => w.type === "do" && w.isCreatorWindow === true,
  );
  if (!found) throw new Error("test setup: expected creator do_window");
  return found;
}

/**
 * 给 thread 挂一个 running 的非 creator do_window（= parent 侧子线程对话）。
 * OOC-4 L6b：wait 候选改按子线程 id（childThreadId=targetThreadId），故返回 childThreadId。
 */
function addRunningChildDo(thread: ThreadContext, childThreadId = "t_child_running"): string {
  const childDo: DoWindow = {
    id: generateWindowId("do"),
    type: "do",
    parentWindowId: ROOT_WINDOW_ID,
    title: "子线程任务",
    status: "running",
    createdAt: Date.now(),
    targetThreadId: childThreadId,
  };
  thread.contextWindows = [...thread.contextWindows, childDo];
  return childThreadId;
}

async function callWaitAsync(
  thread: ThreadContext,
  args: Record<string, unknown>,
): Promise<{ ok: boolean; error?: string; message?: string; on?: string }> {
  const raw = await handleWaitTool(thread, args);
  return JSON.parse(raw);
}

describe("wait tool — explicit IO dependency (spec 2026-05-17)", () => {
  it("R1: 缺 on → reject 且枚举候选", async () => {
    const thread = makeThread();
    // OOC-4 L6b：creator do_window 不再是 wait 候选（它是 child 侧回报口）；挂一个 running
    // 子线程对话作合法候选，验证缺 on 时枚举出 do 候选。
    const childId = addRunningChildDo(thread);
    const out = await callWaitAsync(thread, { reason: "等一下" });
    expect(out.ok).toBe(false);
    expect(out.error).toContain("on");
    expect(out.error).toMatch(/do/);
    expect(out.error).toContain(childId);
  });

  it("R2: on 指向不存在的 window → reject 且枚举候选", async () => {
    const thread = makeThread();
    addRunningChildDo(thread); // 提供合法候选，避免先撞 R5「无任何候选」兜底
    const out = await callWaitAsync(thread, { on: "w_nonexistent" });
    expect(out.ok).toBe(false);
    expect(out.error).toContain("w_nonexistent");
    expect(out.error).toMatch(/未匹配|找不到|未在|候选/);
  });

  it("R3: on 指向 file_window（非 talk/do） → reject 解释类型限制", async () => {
    const thread = makeThread();
    addRunningChildDo(thread); // 提供合法候选，避免先撞 R5「无任何候选」兜底
    const fw: FileWindow = {
      id: generateWindowId("file"),
      type: "file",
      parentWindowId: ROOT_WINDOW_ID,
      title: "README.md",
      status: "open",
      createdAt: Date.now(),
      path: "/tmp/README.md",
    };
    thread.contextWindows = [...thread.contextWindows, fw];
    const out = await callWaitAsync(thread, { on: fw.id });
    expect(out.ok).toBe(false);
    expect(out.error).toContain("file");
    expect(out.error).toMatch(/talk_window|do_window/);
  });

  it("R4: 非 creator talk_window（残留自建）→ reject 并指引改用 peer wait", async () => {
    // OOC-4 L5c：agent 不再自建 talk_window；若仍残留一个非 creator talk_window，
    // wait 拒绝它，指引用 on=<peer objectId>（talks.json peer）。
    const thread = makeThread();
    addRunningChildDo(thread); // 提供合法候选，确保走 R4 reject 而非 R5「无候选」兜底
    const talk: TalkWindow = {
      id: generateWindowId("talk"),
      type: "talk",
      parentWindowId: ROOT_WINDOW_ID,
      title: "assistant",
      status: "open",
      createdAt: Date.now(),
      target: "assistant",
      conversationId: "c1",
      // 注：未设 isCreatorWindow
    };
    thread.contextWindows = [...thread.contextWindows, talk];
    const out = await callWaitAsync(thread, { on: talk.id });
    expect(out.ok).toBe(false);
    expect(out.error).toContain("creator");
    expect(out.error).toContain("peer");
  });

  it("R5: 无任何合法候选 → reject 并强 nudge end", async () => {
    // skipCreatorWindow 让 thread 没有 creator do_window；contextWindows 留空
    const thread = makeThread({ skipCreatorWindow: true });
    const out = await callWaitAsync(thread, { on: "anything" });
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/没有.*可等待|end method/);
  });

  it("happy: on=<子线程 id>（running 子线程对话）→ status=waiting, waitingOn 写入", async () => {
    // OOC-4 L6b：等子线程改按子线程 id（childThreadId），不再按 do_window id；creator do_window
    // 不作 wait child 用（它是 child→parent 回报口 do_continue(target=parent)）。
    const thread = makeThread();
    const childId = addRunningChildDo(thread);
    const out = await callWaitAsync(thread, { on: childId, reason: "等子" });
    expect(out.ok).toBe(true);
    expect(out.on).toBe(childId);
    expect(thread.status).toBe("waiting");
    expect(thread.waitingOn).toBe(childId);
    expect(thread.inboxSnapshotAtWait).toBe(0);
  });

  it("creator do_window 不再是 wait 候选（child 侧回报口走 do_continue(target=parent)）", async () => {
    const thread = makeThread();
    const creatorDo = findCreatorDoWindow(thread);
    // 只有 creator do_window、无其它候选 → 撞 R5「无任何候选」兜底。
    const out = await callWaitAsync(thread, { on: creatorDo.id });
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/没有.*可等待|end method/);
  });

  it("happy: on=<creator talk_window> → 合法（creator 一律允许）", async () => {
    const thread = makeThread({ skipCreatorWindow: true });
    const talk: TalkWindow = {
      id: generateWindowId("talk"),
      type: "talk",
      parentWindowId: ROOT_WINDOW_ID,
      title: "creator",
      status: "open",
      createdAt: Date.now(),
      target: "user",
      conversationId: "c1",
      isCreatorWindow: true,
    };
    thread.contextWindows = [talk];
    const out = await callWaitAsync(thread, { on: talk.id });
    expect(out.ok).toBe(true);
    expect(thread.waitingOn).toBe(talk.id);
    expect(thread.status).toBe("waiting");
  });

  it("happy: on=<talks.json peer objectId> → 合法（已开会话的 peer）", async () => {
    // OOC-4 L5c：等某 peer 回信改为 on=<peer objectId>；候选来自 talks.json 路由。
    const tempRoot = await mkdtemp(join(tmpdir(), "ooc-wait-peer-"));
    try {
      const flow = await createFlowObject({ baseDir: tempRoot, sessionId: "s", objectId: "agent" });
      // 写一条与 peer "bob" 的会话路由到 agent.talks.json
      await setTalkRoute(
        { baseDir: tempRoot, sessionId: "s", objectId: "agent" },
        "bob",
        { targetThreadId: "t_bob_1", conversationId: "conv_agent_bob_1" },
      );
      const thread = makeThread({
        skipCreatorWindow: true,
        persistence: { ...flow, threadId: "root" },
      });
      const out = await callWaitAsync(thread, { on: "bob" });
      expect(out.ok).toBe(true);
      expect(out.on).toBe("bob");
      expect(thread.status).toBe("waiting");
      expect(thread.waitingOn).toBe("bob");
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("on=<archived do_window id> → reject（do 的 alive 状态是 running）", async () => {
    // 必须有另一个合法候选（running 子线程对话），否则会先撞 R5 "无任何候选" 兜底。
    const thread = makeThread();
    addRunningChildDo(thread);
    const archived: DoWindow = {
      id: generateWindowId("do"),
      type: "do",
      parentWindowId: ROOT_WINDOW_ID,
      title: "child task",
      status: "archived",
      createdAt: Date.now(),
      targetThreadId: "t_child_archived",
    };
    thread.contextWindows = [...thread.contextWindows, archived];
    // OOC-4 L6b：archived do_window 不在候选里（按子线程 id 寻址），传它的 window id 命中
    // findWindow → do 分支 reject（archived / 非 running）。
    const out = await callWaitAsync(thread, { on: archived.id });
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/archived|非 running/);
  });
});

