/**
 * talk-delivery unit tests — focused on the super alias path added in
 * spec 2026-05-18 (super-flow-channel). The existing same-session happy path
 * is covered by step2-windows.test.ts; this file targets:
 *
 *  - regression: non-"super" target still dispatches to caller's session
 *  - happy: target="super" creates flows/super/.session.json + flows/super/<caller>/
 *  - edge: caller already in super session calling target="super" stays inside super
 */
import { describe, expect, it } from "bun:test";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdir } from "node:fs/promises";
import { createFlowObject, createFlowSession, readThread, writeThread, nestedObjectPath } from "../../../persistable";
import { stoneDir, STONES_MAIN_BRANCH } from "../../../persistable/common";
import { deliverTalkMessage } from "../talk/delivery";
import { SUPER_ALIAS_TARGET, SUPER_SESSION_ID } from "@ooc/core/_shared/types/constants.js";
import { initContextWindows } from "../_shared/init";
import { ROOT_WINDOW_ID, generateWindowId, type TalkWindow } from "../_shared/types";
import type { ThreadContext } from "../../../thinkable/context";

async function setupCaller(opts: {
  baseDir: string;
  sessionId: string;
  objectId: string;
  target: string;
  /** caller 是否 canonical（stones/main/objects/<id>/ 存在）；默认 true。super-alias 自指路径靠它。 */
  canonical?: boolean;
}): Promise<{ thread: ThreadContext; talkWindow: TalkWindow }> {
  await createFlowSession(opts.baseDir, opts.sessionId);
  if (opts.canonical !== false) {
    // canonical = stones/main/objects/<nestedPath>/ 存在（与 ensureAuthorExists / resolveSuperActor 同寻址）。
    await mkdir(
      stoneDir({ baseDir: opts.baseDir, objectId: opts.objectId, _stonesBranch: STONES_MAIN_BRANCH }),
      { recursive: true },
    );
  }
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
    class: "talk",
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
        tempRoot, "flows", "web-test", "objects", ...nestedObjectPath("bob"), "threads", delivered.calleeThreadId,
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

  it("happy: target='super' creates flows/super/.session.json + flows/super/<caller>/", async () => {
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
        tempRoot, "flows", SUPER_SESSION_ID, "objects", ...nestedObjectPath("alice"), "threads", delivered.calleeThreadId,
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
        tempRoot, "flows", SUPER_SESSION_ID, "objects", ...nestedObjectPath("alice"), "threads", delivered.calleeThreadId,
      );
      await expect(stat(calleeDir)).resolves.toBeDefined();
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  // #3（reflectable 新对象自沉淀 bootstrap）：新对象只在 session worktree 存在、未 canonical，
  // 不能当 super-flow actor / PR author。super-alias 的 callee 冒泡到最近 canonical 祖先；
  // 顶层新对象（无路径 parent）→ supervisor。canonical caller 自指不变（上面 happy/edge 已覆盖）。
  it("#3 顶层新对象 target='super' → 冒泡到 supervisor 代发", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "ooc-tdsa-"));
    try {
      // supervisor 恒 canonical（bootstrap）；新对象 bar 未 canonical
      await mkdir(stoneDir({ baseDir: tempRoot, objectId: "supervisor", _stonesBranch: STONES_MAIN_BRANCH }), {
        recursive: true,
      });
      const { thread, talkWindow } = await setupCaller({
        baseDir: tempRoot, sessionId: "web-test", objectId: "bar", target: SUPER_ALIAS_TARGET, canonical: false,
      });
      const delivered = await deliverTalkMessage({
        caller: { thread, talkWindow }, content: "sediment me", source: "talk",
      });
      // callee = 最近 canonical 祖先 = supervisor（顶层兜底），不是 bar 自己
      expect(delivered.calleeObjectId).toBe("supervisor");
      const superSupervisorDir = join(
        tempRoot, "flows", SUPER_SESSION_ID, "objects", ...nestedObjectPath("supervisor"), "threads", delivered.calleeThreadId,
      );
      await expect(stat(superSupervisorDir)).resolves.toBeDefined();
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("#3 nested 新对象 target='super' → 冒泡到最近 canonical 祖先", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "ooc-tdsa-"));
    try {
      // alice canonical（parent）；alice/baz 是 session 内新对象
      await mkdir(stoneDir({ baseDir: tempRoot, objectId: "alice", _stonesBranch: STONES_MAIN_BRANCH }), {
        recursive: true,
      });
      const { thread, talkWindow } = await setupCaller({
        baseDir: tempRoot, sessionId: "web-test", objectId: "alice/baz", target: SUPER_ALIAS_TARGET, canonical: false,
      });
      const delivered = await deliverTalkMessage({
        caller: { thread, talkWindow }, content: "sediment me", source: "talk",
      });
      expect(delivered.calleeObjectId).toBe("alice");
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  // super→origin 回报通道回归（reflectable harness sweep [med] 修复）：
  // super-alice（super session）通过 creator talk_window 回报创建者 alice（user session）。
  // 修复前：creator window 被 init 误判为 do_window → do_window.continue/say 路由进自身
  // （super）session → 永远找不到 user-session 的创建者 thread → 静默失败。
  // 修复后：(1) init 给 cross-session creator 落 talk_window；(2) delivery 按 creatorSessionId
  // 把回报派回 user session 的原始创建者 thread。
  it("super->origin: creator talk_window reply routes back to caller's session", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "ooc-tdsa-"));
    try {
      // 1) user session 的 alice 创建者 root thread
      await createFlowSession(tempRoot, "web-test");
      const userFlow = await createFlowObject({
        baseDir: tempRoot, sessionId: "web-test", objectId: "alice",
      });
      const userAliceRoot: ThreadContext = {
        id: "root",
        status: "waiting",
        events: [],
        contextWindows: [],
        persistence: { ...userFlow, threadId: "root" },
      };
      initContextWindows(userAliceRoot, { initialTaskTitle: "user task" });
      await writeThread(userAliceRoot);

      // 2) super session 的 super-alice，creatorObjectId=alice + creatorSessionId="web-test"
      await createFlowSession(tempRoot, SUPER_SESSION_ID);
      const superFlow = await createFlowObject({
        baseDir: tempRoot, sessionId: SUPER_SESSION_ID, objectId: "alice",
      });
      const superAlice: ThreadContext = {
        id: "t_super_alice",
        status: "running",
        events: [],
        contextWindows: [],
        creatorThreadId: "root",
        creatorObjectId: "alice",
        creatorSessionId: "web-test",
        persistence: { ...superFlow, threadId: "t_super_alice" },
      };
      // creator window 类型由 init 决定：cross-session 同 object → 必须是 talk（非 do）
      initContextWindows(superAlice, { creatorThreadId: "root", initialTaskTitle: "reflect" });
      const creator = superAlice.contextWindows.find((w) => (w as TalkWindow).isCreatorWindow);
      expect(creator).toBeDefined();
      expect(creator!.class).toBe("talk"); // ← 修复核心：cross-session creator 不是 do
      expect((creator as TalkWindow).target).toBe("alice");
      expect((creator as TalkWindow).targetThreadId).toBe("root");
      await writeThread(superAlice);

      // 3) super-alice 通过 creator talk_window 回报
      const delivered = await deliverTalkMessage({
        caller: { thread: superAlice, talkWindow: creator as TalkWindow },
        content: "已沉淀：见 memory/x.md",
        source: "talk",
      });

      // 4) 回报必须落到 user session 的原始创建者 thread（不是 super session）
      expect(delivered.calleeObjectId).toBe("alice");
      expect(delivered.calleeThreadId).toBe("root");
      const userCallee = await readThread(
        { baseDir: tempRoot, sessionId: "web-test", objectId: "alice" },
        "root",
      );
      expect(userCallee).toBeDefined();
      expect(userCallee!.persistence?.sessionId).toBe("web-test");
      // 消息真的进了 user-alice 的 inbox（不是静默失败）
      const arrived = (userCallee!.inbox ?? []).some((m) => m.content === "已沉淀：见 memory/x.md");
      expect(arrived).toBe(true);
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
          tempRoot, "flows", SUPER_SESSION_ID, "objects", ...nestedObjectPath("alice"), "threads", delivered.calleeThreadId,
        );
        await expect(stat(superAliceDir)).resolves.toBeDefined();
      } finally {
        await rm(tempRoot, { recursive: true, force: true });
      }
    },
  );
});
