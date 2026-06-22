import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { derivePeerObjectWindows } from "../object-windows.js";
import { makeThread } from "@ooc/core/__tests__/make-thread";
import { setSessionObject } from "@ooc/core/runtime/session-object-table.js";
import {
  createStoneObject,
  writeReadable,
} from "@ooc/core/persistable";

describe("derivePeerObjectWindows (ooc-6 Phase 6)", () => {
  let baseDir: string;

  beforeEach(async () => {
    baseDir = await mkdtemp(join(tmpdir(), "ooc-peer-obj-"));
  });

  afterEach(async () => {
    await rm(baseDir, { recursive: true, force: true });
  });

  // talk 窗 spec：B→A 后窗（OocObjectRef）不持 data，data 经 session 对象表解析。
  // 这里记下 spec，makePeerThread 构造时把窗（ref）入 contextWindows、data 入对象表。
  interface TalkWinSpec {
    id: string;
    class: string;
    target: string;
    conversationId: string;
    createdAt: number;
  }

  function makePeerThread(objectId: string, talkSpecs: TalkWinSpec[] = []): any {
    const extraWindows = talkSpecs.map((s) => ({
      id: s.id,
      class: s.class,
      parentWindowId: "root",
      title: `talk to ${s.target}`,
      status: "open" as const,
      createdAt: s.createdAt,
    }));
    const thread = makeThread({
      id: "t_root",
      objectId,
      persistence: { baseDir, sessionId: "sess_1", objectId, threadId: "t_root" },
      extraWindows,
      skipCreatorWindow: true,
    });
    // 窗引用的对象 data（target / conversationId）登记进 session 对象表（objectDataOf 经此解析）。
    for (const s of talkSpecs) {
      setSessionObject(thread, {
        id: s.id,
        class: s.class,
        data: { target: s.target, conversationId: s.conversationId },
      });
    }
    return thread;
  }

  // Wave4 会话窗：stored class = _builtin/agent/thread；target / conversationId 落对象 data
  // （talk 只是 readable 投影 class，peer 派生按 isTalkLikeClass 认 thread class）。
  function talkWin(id: string, target: string, createdAt = 100): TalkWinSpec {
    return {
      id,
      class: "_builtin/agent/thread",
      target,
      conversationId: `conv_${id}`,
      createdAt,
    };
  }

  it("returns empty array when no persistence", async () => {
    const thread = makeThread({ persistence: undefined });
    const result = await derivePeerObjectWindows(thread);
    expect(result.length).toBe(0);
  });

  it("returns empty array when no peers", async () => {
    const thread = makePeerThread("agent_self");
    const result = await derivePeerObjectWindows(thread);
    expect(result.length).toBe(0);
  });

  it("derives peer object from talk_window target", async () => {
    const thread = makePeerThread("agent_self", [talkWin("w_talk_1", "agent_peer1")]);
    const result = await derivePeerObjectWindows(thread);
    expect(result.length).toBe(1);
    expect(result[0]!.class).toBe("agent_peer1");
    expect(result[0]!.id).toBe("agent_peer1");
  });

  it("skips super alias target", async () => {
    const thread = makePeerThread("agent_self", [talkWin("w_talk_1", "super")]);
    const result = await derivePeerObjectWindows(thread);
    expect(result.length).toBe(0);
  });

  it("derives user as peer object from talk_window (user 不再特殊排除，统一作 context window)", async () => {
    const thread = makePeerThread("agent_self", [talkWin("w_talk_user", "user")]);
    const result = await derivePeerObjectWindows(thread);
    expect(result.map((w) => w.id)).toContain("user");
    expect(result.find((w) => w.id === "user")?.class).toBe("user");
  });

  it("derives peer objects from sibling stones (default visibility)", async () => {
    await createStoneObject({ baseDir, objectId: "agent_sibling1" });
    await writeReadable(
      { baseDir, objectId: "agent_sibling1" },
      "---\ntitle: Sibling Agent 1\n---\nI am a sibling agent.",
    );
    await createStoneObject({ baseDir, objectId: "agent_sibling2" });

    const thread = makePeerThread("agent_self");
    const result = await derivePeerObjectWindows(thread);
    const peerIds = result.map((w) => w.id).sort();
    expect(peerIds).toContain("agent_sibling1");
    expect(peerIds).toContain("agent_sibling2");
    const sibling1 = result.find((w) => w.id === "agent_sibling1");
    expect(sibling1?.title).toBe("Sibling Agent 1");
  });

  it("derives both talk peers and sibling stones", async () => {
    await createStoneObject({ baseDir, objectId: "agent_sibling" });

    const thread = makePeerThread("agent_self", [talkWin("w_talk_1", "agent_talk_peer")]);
    const result = await derivePeerObjectWindows(thread);
    const peerIds = result.map((w) => w.id).sort();
    expect(peerIds).toEqual(["agent_sibling", "agent_talk_peer"]);
  });

  it("deduplicates same peer from talk and sibling", async () => {
    await createStoneObject({ baseDir, objectId: "agent_peer" });

    const thread = makePeerThread("agent_self", [talkWin("w_talk_1", "agent_peer", 50)]);
    const result = await derivePeerObjectWindows(thread);
    const peerWindows = result.filter((w) => w.id === "agent_peer");
    expect(peerWindows.length).toBe(1);
    expect(peerWindows[0]!.createdAt).toBe(50);
  });
});
