/**
 * wait tool 5 条 reject 分支 + happy path 的单元测试。
 *
 * talk 统一后会话窗（creator/peer/fork）的 inst.class 一律 = THREAD_CLASS_ID（唯一会话载体注册
 * class）；wait 候选都是会话窗。Wave 4 信封：业务字段（target/targetThreadId/isForkWindow）落
 * inst.data；creator 窗身份由 id（threadWindowIdOf）派生，不存 isCreatorWindow flag。
 */

import { describe, expect, it } from "bun:test";
import { handleWaitTool } from "../tools/wait";
import { makeThread } from "../../__tests__/make-thread";
import type { ThreadContext } from "../../thinkable/context";
import type { OocObjectInstance } from "../../runtime/ooc-class.js";
import {
  generateWindowId,
  threadWindowIdOf,
  isSelfThreadWindow,
  ROOT_WINDOW_ID,
} from "@ooc/core/_shared/types/context-window.js";
import { THREAD_CLASS_ID } from "@ooc/core/_shared/types/constants.js";

/** 造一个会话窗实例信封（inst.class=THREAD_CLASS_ID，业务字段落 inst.data）。 */
function makeTalkInstance(
  id: string,
  data: Record<string, unknown>,
  status: OocObjectInstance["status"] = "open",
): OocObjectInstance {
  return {
    id,
    class: THREAD_CLASS_ID,
    parentObjectId: ROOT_WINDOW_ID,
    title: typeof data.target === "string" ? (data.target as string) : "talk",
    status,
    createdAt: Date.now(),
    data,
  };
}

function findCreatorTalkWindow(thread: ThreadContext): OocObjectInstance {
  const found = thread.contextWindows.find(
    (w) => w.class === THREAD_CLASS_ID && isSelfThreadWindow(w.id),
  );
  if (!found) throw new Error("test setup: expected creator 会话窗");
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
    // makeThread 默认注入 creator 会话窗（fork 子窗）作为候选
    expect(out.error).toMatch(/fork|talk/);
  });

  it("R2: on 指向不存在的 window → reject 且枚举候选", async () => {
    const thread = makeThread();
    const out = await callWaitAsync(thread, { on: "w_nonexistent" });
    expect(out.ok).toBe(false);
    expect(out.error).toContain("w_nonexistent");
    expect(out.error).toMatch(/找不到|未在|候选/);
  });

  it("R3: on 指向 file 窗（非会话窗） → reject 解释类型限制", async () => {
    const thread = makeThread();
    const fw: OocObjectInstance = {
      id: generateWindowId("file"),
      class: "file",
      parentObjectId: ROOT_WINDOW_ID,
      title: "README.md",
      status: "open",
      createdAt: Date.now(),
      data: { path: "/tmp/README.md" },
    };
    thread.contextWindows = [...thread.contextWindows, fw];
    const out = await callWaitAsync(thread, { on: fw.id });
    expect(out.ok).toBe(false);
    expect(out.error).toContain("file");
    expect(out.error).toMatch(/talk_window/);
  });

  it("R4: 自建 peer 会话窗未 say 过 → reject 并指引先 say", async () => {
    const thread = makeThread();
    // 非 creator id + 非 fork → 自建 peer 会话窗
    const talk = makeTalkInstance(generateWindowId("talk"), { target: "assistant" });
    thread.contextWindows = [...thread.contextWindows, talk];
    // outbox 上没有 windowId=talk.id 的消息
    const out = await callWaitAsync(thread, { on: talk.id });
    expect(out.ok).toBe(false);
    expect(out.error).toContain("say");
    expect(out.error).toContain(talk.id);
  });

  it("R5: 无任何合法候选 → reject 并强 nudge end", async () => {
    // skipCreatorWindow 让 thread 没有 creator 会话窗；contextWindows 留空
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

  it("happy: on=<creator peer 会话窗> → 合法（creator 一律允许）", async () => {
    const thread = makeThread({ skipCreatorWindow: true });
    // creator 身份编码在 id（threadWindowIdOf(thread.id)）里。
    const talk = makeTalkInstance(threadWindowIdOf(thread.id), { target: "user" });
    thread.contextWindows = [talk];
    const out = await callWaitAsync(thread, { on: talk.id });
    expect(out.ok).toBe(true);
    expect(thread.waitingOn).toBe(talk.id);
    expect(thread.status).toBe("waiting");
  });

  it("happy: on=<自建 peer 会话窗但已 say 过> → 合法", async () => {
    const thread = makeThread();
    const talk = makeTalkInstance(generateWindowId("talk"), { target: "assistant" });
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
    const closedFork = makeTalkInstance(
      generateWindowId("talk"),
      { target: "alice", targetThreadId: "t_child", isForkWindow: true },
      "closed",
    );
    thread.contextWindows = [...thread.contextWindows, closedFork];
    const out = await callWaitAsync(thread, { on: closedFork.id });
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/closed|非 open/);
  });
});
