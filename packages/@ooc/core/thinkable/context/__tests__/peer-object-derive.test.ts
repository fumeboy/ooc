import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { derivePeerObjectWindows } from "../object-windows.js";
import { makeThread } from "../../../__tests__/make-thread";
import {
  createStoneObject,
  writeReadable,
} from "../../../persistable";

describe("derivePeerObjectWindows (ooc-6 Phase 6)", () => {
  let baseDir: string;

  beforeEach(async () => {
    baseDir = await mkdtemp(join(tmpdir(), "ooc-peer-obj-"));
  });

  afterEach(async () => {
    await rm(baseDir, { recursive: true, force: true });
  });

  function makePeerThread(objectId: string, extraWindows: any[] = []): any {
    return makeThread({
      id: "t_root",
      objectId,
      persistence: { baseDir, sessionId: "sess_1", objectId, threadId: "t_root" },
      extraWindows,
      skipCreatorWindow: true,
    });
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
    const thread = makePeerThread("agent_self", [
      {
        id: "w_talk_1",
        class: "talk",
        parentWindowId: "root",
        title: "talk to peer1",
        status: "open",
        createdAt: 100,
        target: "agent_peer1",
        conversationId: "conv1",
      },
    ]);
    const result = await derivePeerObjectWindows(thread);
    expect(result.length).toBe(1);
    expect(result[0]!.class).toBe("agent_peer1" as any);
    expect(result[0]!.id).toBe("agent_peer1");
  });

  it("skips super alias target", async () => {
    const thread = makePeerThread("agent_self", [
      {
        id: "w_talk_1",
        class: "talk",
        parentWindowId: "root",
        title: "talk to super",
        status: "open",
        createdAt: 100,
        target: "super",
        conversationId: "conv1",
      },
    ]);
    const result = await derivePeerObjectWindows(thread);
    expect(result.length).toBe(0);
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

    const thread = makePeerThread("agent_self", [
      {
        id: "w_talk_1",
        class: "talk",
        parentWindowId: "root",
        title: "talk to peer",
        status: "open",
        createdAt: 100,
        target: "agent_talk_peer",
        conversationId: "conv1",
      },
    ]);
    const result = await derivePeerObjectWindows(thread);
    const peerIds = result.map((w) => w.id).sort();
    expect(peerIds).toEqual(["agent_sibling", "agent_talk_peer"]);
  });

  it("deduplicates same peer from talk and sibling", async () => {
    await createStoneObject({ baseDir, objectId: "agent_peer" });

    const thread = makePeerThread("agent_self", [
      {
        id: "w_talk_1",
        class: "talk",
        parentWindowId: "root",
        title: "talk to peer",
        status: "open",
        createdAt: 50,
        target: "agent_peer",
        conversationId: "conv1",
      },
    ]);
    const result = await derivePeerObjectWindows(thread);
    const peerWindows = result.filter((w) => w.id === "agent_peer");
    expect(peerWindows.length).toBe(1);
    expect(peerWindows[0]!.createdAt).toBe(50);
  });
});
