/**
 * wait tool 5 条 reject 分支 + happy path 的单元测试。
 *
 * talk 统一后，creator 窗一律是 talk_window（fork 子窗或 peer 会话窗），wait 候选都是 talk_window。
 */

import { describe, expect, it } from "bun:test";
import { handleWaitTool } from "../tools/wait";
import { makeThread } from "../../__tests__/make-thread";
import type { ThreadContext } from "../../thinkable/context";
import {
  generateWindowId,
  ROOT_WINDOW_ID,
  type FileWindow,
  type TalkWindow,
} from "../windows/_shared/types";

function findCreatorTalkWindow(thread: ThreadContext): TalkWindow {
  const found = thread.contextWindows.find(
    (w): w is TalkWindow => w.class === "talk" && (w as TalkWindow).isCreatorWindow === true,
  );
  if (!found) throw new Error("test setup: expected creator talk_window");
  return found;
}

async function callWaitAsync(
  thread: ThreadContext,
  args: Record<string, unknown>,
): Promise<{ ok: boolean; error?: string; message?: string; on?: string }> {
  const raw = await handleWaitTool(thread, args);
  return JSON.parse(raw);
}

describe("wait tool — explicit IO dependency", () => {
  it("R1: 缺 on → reject 且枚举候选", async () => {
    const thread = makeThread();
    const out = await callWaitAsync(thread, { reason: "等一下" });
    expect(out.ok).toBe(false);
    expect(out.error).toContain("on");
    // makeThread 默认注入 creator talk_window（fork 子窗）作为候选
    expect(out.error).toMatch(/fork|talk/);
  });

  it("R2: on 指向不存在的 window → reject 且枚举候选", async () => {
    const thread = makeThread();
    const out = await callWaitAsync(thread, { on: "w_nonexistent" });
    expect(out.ok).toBe(false);
    expect(out.error).toContain("w_nonexistent");
    expect(out.error).toMatch(/找不到|未在|候选/);
  });

  it("R3: on 指向 file_window（非 talk） → reject 解释类型限制", async () => {
    const thread = makeThread();
    const fw: FileWindow = {
      id: generateWindowId("file"),
      class: "file",
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
    expect(out.error).toMatch(/talk_window/);
  });

  it("R4: 自建 peer talk_window 未 say 过 → reject 并指引先 say", async () => {
    const thread = makeThread();
    const talk: TalkWindow = {
      id: generateWindowId("talk"),
      class: "talk",
      parentWindowId: ROOT_WINDOW_ID,
      title: "assistant",
      status: "open",
      createdAt: Date.now(),
      target: "assistant",
      conversationId: "c1",
      // 注：未设 isCreatorWindow / isForkWindow → 自建 peer 会话窗
    };
    thread.contextWindows = [...thread.contextWindows, talk];
    // outbox 上没有 windowId=talk.id 的消息
    const out = await callWaitAsync(thread, { on: talk.id });
    expect(out.ok).toBe(false);
    expect(out.error).toContain("say");
    expect(out.error).toContain(talk.id);
  });

  it("R5: 无任何合法候选 → reject 并强 nudge end", async () => {
    // skipCreatorWindow 让 thread 没有 creator talk_window；contextWindows 留空
    const thread = makeThread({ skipCreatorWindow: true });
    const out = await callWaitAsync(thread, { on: "anything" });
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/没有.*可等待|end method/);
  });

  it("happy: on=<creator fork 窗> → status=waiting, waitingOn 写入", async () => {
    const thread = makeThread();
    const creator = findCreatorTalkWindow(thread);
    const out = await callWaitAsync(thread, { on: creator.id, reason: "等子" });
    expect(out.ok).toBe(true);
    expect(out.on).toBe(creator.id);
    expect(thread.status).toBe("waiting");
    expect(thread.waitingOn).toBe(creator.id);
    expect(thread.inboxSnapshotAtWait).toBe(0);
  });

  it("happy: on=<creator peer talk_window> → 合法（creator 一律允许）", async () => {
    const thread = makeThread({ skipCreatorWindow: true });
    const talk: TalkWindow = {
      id: generateWindowId("talk"),
      class: "talk",
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

  it("happy: on=<自建 peer talk_window 但已 say 过> → 合法", async () => {
    const thread = makeThread();
    const talk: TalkWindow = {
      id: generateWindowId("talk"),
      class: "talk",
      parentWindowId: ROOT_WINDOW_ID,
      title: "assistant",
      status: "open",
      createdAt: Date.now(),
      target: "assistant",
      conversationId: "c2",
    };
    thread.contextWindows = [...thread.contextWindows, talk];
    thread.outbox = [
      {
        id: "msg_1",
        fromThreadId: thread.id,
        toThreadId: "t_other",
        content: "hi",
        createdAt: Date.now(),
        source: "talk",
        windowId: talk.id,
      },
    ];
    const out = await callWaitAsync(thread, { on: talk.id });
    expect(out.ok).toBe(true);
    expect(thread.waitingOn).toBe(talk.id);
  });

  it("on=closed fork 子窗 → reject（会话窗 alive 状态是 open）", async () => {
    // 必须有另一个合法候选，否则会先撞 R5 "无任何候选" 兜底
    const thread = makeThread();
    const closedFork: TalkWindow = {
      id: generateWindowId("talk"),
      class: "talk",
      parentWindowId: ROOT_WINDOW_ID,
      title: "child task",
      status: "closed",
      createdAt: Date.now(),
      target: "alice",
      targetThreadId: "t_child",
      isForkWindow: true,
      conversationId: "c3",
    };
    thread.contextWindows = [...thread.contextWindows, closedFork];
    const out = await callWaitAsync(thread, { on: closedFork.id });
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/closed|非 open/);
  });
});
