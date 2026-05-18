/**
 * talk-delivery unit tests — focused on the super alias path added in
 * spec 2026-05-18 (super-flow-channel). The existing same-session happy path
 * is covered by step2-windows.test.ts; this file targets:
 *
 *  - regression: non-"super" target still dispatches to caller's session
 *  - happy: target="super" creates flows/super/.session.json + flows/super/objects/<caller>/
 *  - edge: caller already in super session calling target="super" stays inside super
 */
import { describe, expect, it } from "bun:test";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createFlowObject, createFlowSession, readThread, writeThread } from "../../../persistable";
import { deliverTalkMessage } from "../talk-delivery";
import { SUPER_ALIAS_TARGET, SUPER_SESSION_ID } from "../super-constants";
import { initContextWindows } from "../init";
import { ROOT_WINDOW_ID, generateWindowId, type TalkWindow } from "../types";
import type { ThreadContext } from "../../../thinkable/context";

async function setupCaller(opts: {
  baseDir: string;
  sessionId: string;
  objectId: string;
  target: string;
}): Promise<{ thread: ThreadContext; talkWindow: TalkWindow }> {
  await createFlowSession(opts.baseDir, opts.sessionId);
  const flow = await createFlowObject({
    baseDir: opts.baseDir,
    sessionId: opts.sessionId,
    objectId: opts.objectId,
  });
  const thread: ThreadContext = {
    id: "root",
    status: "running",
    events: [],
    contextWindows: [],
    persistence: { ...flow, threadId: "root" },
  };
  initContextWindows(thread, { initialTaskTitle: "test caller" });
  const talkWindowId = generateWindowId("talk");
  const talkWindow: TalkWindow = {
    id: talkWindowId,
    type: "talk",
    parentWindowId: ROOT_WINDOW_ID,
    title: `talk-${opts.target}`,
    status: "open",
    createdAt: Date.now(),
    target: opts.target,
    conversationId: talkWindowId,
  };
  thread.contextWindows = [...thread.contextWindows, talkWindow];
  await writeThread(thread);
  return { thread, talkWindow };
}

describe("talk-delivery target='super' alias", () => {
  it("regression: target='bob' still dispatches in caller's session", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "ooc-tdsa-"));
    try {
      const { thread, talkWindow } = await setupCaller({
        baseDir: tempRoot, sessionId: "web-test", objectId: "alice", target: "bob",
      });
      const delivered = await deliverTalkMessage({
        caller: { thread, talkWindow }, content: "hi bob", source: "talk",
      });
      expect(delivered.calleeObjectId).toBe("bob");
      // bob 落在 caller 的 session (web-test)，不是 super
      const bobThreadDir = join(
        tempRoot, "flows", "web-test", "objects", "bob", "threads", delivered.calleeThreadId,
      );
      await expect(stat(bobThreadDir)).resolves.toBeDefined();
      // 显式断言 callee thread persistence 写的就是 caller 的 sessionId，不是 super
      const callee = await readThread(
        { baseDir: tempRoot, sessionId: "web-test", objectId: "bob" },
        delivered.calleeThreadId,
      );
      expect(callee?.persistence?.sessionId).toBe("web-test");
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("happy: target='super' creates flows/super/.session.json + flows/super/objects/<caller>/", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "ooc-tdsa-"));
    try {
      const { thread, talkWindow } = await setupCaller({
        baseDir: tempRoot, sessionId: "web-test", objectId: "alice", target: SUPER_ALIAS_TARGET,
      });
      const delivered = await deliverTalkMessage({
        caller: { thread, talkWindow }, content: "self check", source: "talk",
      });
      // 自指：callee = caller.objectId
      expect(delivered.calleeObjectId).toBe("alice");
      // 跨入 super session
      const superSessionFile = join(tempRoot, "flows", SUPER_SESSION_ID, ".session.json");
      await expect(stat(superSessionFile)).resolves.toBeDefined();
      const superAliceThreadDir = join(
        tempRoot, "flows", SUPER_SESSION_ID, "objects", "alice", "threads", delivered.calleeThreadId,
      );
      await expect(stat(superAliceThreadDir)).resolves.toBeDefined();
      // 读 callee thread 验证 persistence 字段
      const callee = await readThread(
        { baseDir: tempRoot, sessionId: SUPER_SESSION_ID, objectId: "alice" },
        delivered.calleeThreadId,
      );
      expect(callee).toBeDefined();
      expect(callee!.persistence?.sessionId).toBe(SUPER_SESSION_ID);
      expect(callee!.persistence?.objectId).toBe("alice");
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("edge: caller already in super session + target='super' stays inside super", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "ooc-tdsa-"));
    try {
      const { thread, talkWindow } = await setupCaller({
        baseDir: tempRoot, sessionId: SUPER_SESSION_ID, objectId: "alice", target: SUPER_ALIAS_TARGET,
      });
      const delivered = await deliverTalkMessage({
        caller: { thread, talkWindow }, content: "self recurse", source: "talk",
      });
      expect(delivered.calleeObjectId).toBe("alice");
      // 同 super session 内自指——不递归创建嵌套 super
      const calleeDir = join(
        tempRoot, "flows", SUPER_SESSION_ID, "objects", "alice", "threads", delivered.calleeThreadId,
      );
      await expect(stat(calleeDir)).resolves.toBeDefined();
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  // case-insensitive alias detection: 'Super' / ' super ' 等都触发 super 别名，
  // 防止与 service 层的 isSuperSessionId 守卫产生不一致（一边拒一边放过会让用户
  // 创建出名为 'Super' 的普通对象）。
  it.each(["Super", " super ", "SUPER", "sUpEr"])(
    "edge: target=%p (any case/whitespace) triggers super alias",
    async (target) => {
      const tempRoot = await mkdtemp(join(tmpdir(), "ooc-tdsa-"));
      try {
        const { thread, talkWindow } = await setupCaller({
          baseDir: tempRoot, sessionId: "web-test", objectId: "alice", target,
        });
        const delivered = await deliverTalkMessage({
          caller: { thread, talkWindow }, content: "case check", source: "talk",
        });
        expect(delivered.calleeObjectId).toBe("alice");
        const superAliceDir = join(
          tempRoot, "flows", SUPER_SESSION_ID, "objects", "alice", "threads", delivered.calleeThreadId,
        );
        await expect(stat(superAliceDir)).resolves.toBeDefined();
      } finally {
        await rm(tempRoot, { recursive: true, force: true });
      }
    },
  );
});
