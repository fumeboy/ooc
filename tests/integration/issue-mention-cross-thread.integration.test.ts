/**
 * U12 集成测试 — cross-thread Issue mention(non-LLM)
 *
 * 验证 plan §5 U9 / §4 决策 3,7,10,11 + A1:
 * - push 路径:appendComment 后,subscribers 通过 scan 找到(F4)
 * - sync 路径:syncIssueWindowComments 在 worker tick 翻 inbox + 唤醒
 * - self-skip:author=self 不通知
 * - mention 路径:含 @self 的 comment 写 inbox
 * - 10s 限频:非 waiting 时被限频压制
 * - wait-all:waiting+waitingOn=window → 绕过限频
 * - close fallback:Issue closed → 写 inbox + 移除 window
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  __resetSerialQueueForTests,
  createFlowObject,
  createStoneObject,
  findIssueSubscribers,
  issuesService,
  readThread,
  writeThread,
} from "../../src/persistable";
import type { ThreadContext } from "../../src/thinkable/context";
import type { IssueWindow } from "../../src/executable/windows/_shared/types";
import { setupTempFlow } from "./_fixture";

// 触发 windows registry seed(import "issue.js" 副作用)
import "../../src/executable/windows";

interface World {
  baseDir: string;
  aliceThread: ThreadContext;
  bobThread: ThreadContext;
  issueId: number;
  aliceWindowId: string;
  bobWindowId: string;
  cleanup: () => Promise<void>;
}

async function setupWorld(): Promise<World> {
  const { tempRoot, cleanup } = await setupTempFlow();
  // 1) stones for alice / bob(author 校验需要)
  await createStoneObject({ baseDir: tempRoot, objectId: "alice" });
  await createStoneObject({ baseDir: tempRoot, objectId: "bob" });

  // 2) flow objects + threads
  const aliceFlow = await createFlowObject({ baseDir: tempRoot, sessionId: "s1", objectId: "alice" });
  const bobFlow = await createFlowObject({ baseDir: tempRoot, sessionId: "s1", objectId: "bob" });

  // 3) 创建一个 Issue,alice 是作者
  const issue = await issuesService.createIssue({
    baseDir: tempRoot,
    sessionId: "s1",
    title: "test issue",
    description: "desc",
    createdByObjectId: "alice",
  });

  // 4) alice / bob 各持有该 IssueWindow
  const aliceWindow: IssueWindow = {
    id: "w_issue_alice_1",
    type: "issue",
    parentWindowId: "root",
    title: "Issue 1",
    status: "open",
    createdAt: Date.now(),
    issueId: issue.id,
    lastSeenCommentId: 0,
  };
  const bobWindow: IssueWindow = {
    id: "w_issue_bob_1",
    type: "issue",
    parentWindowId: "root",
    title: "Issue 1",
    status: "open",
    createdAt: Date.now(),
    issueId: issue.id,
    lastSeenCommentId: 0,
  };

  const aliceThread: ThreadContext = {
    id: "alice_t1",
    status: "running",
    events: [],
    contextWindows: [aliceWindow],
    persistence: { ...aliceFlow, threadId: "alice_t1" },
  };
  const bobThread: ThreadContext = {
    id: "bob_t1",
    status: "running",
    events: [],
    contextWindows: [bobWindow],
    persistence: { ...bobFlow, threadId: "bob_t1" },
  };

  await writeThread(aliceThread);
  await writeThread(bobThread);

  return {
    baseDir: tempRoot,
    aliceThread,
    bobThread,
    issueId: issue.id,
    aliceWindowId: aliceWindow.id,
    bobWindowId: bobWindow.id,
    cleanup,
  };
}

/** 调内置 worker syncIssueWindowComments — 用 dynamic import 拿到 internal helper。
 *  worker.ts 没 export syncIssueWindowComments(它是 file-private);测试通过运行
 *  整个 runJob 验证;或直接用 readThread+inline copy。简单起见:
 *  直接 import 不走 export — 用 module-level 测;若 syncIssueWindowComments 是私有,
 *  我们改成在 worker.ts 中 export 仅供测试。 */
// (see export below)
import { syncIssueWindowCommentsForTest } from "../../src/app/server/runtime/worker";

let world: World | undefined;

beforeEach(() => {
  __resetSerialQueueForTests();
});

afterEach(async () => {
  if (world) {
    await world.cleanup();
    world = undefined;
  }
});

describe("U12: cross-thread Issue mention (non-LLM integration)", () => {
  test("self-skip: author=alice → alice 自己不写 inbox", async () => {
    world = await setupWorld();
    await issuesService.appendComment({
      baseDir: world.baseDir,
      sessionId: "s1",
      issueId: world.issueId,
      text: "我自己的笔记 @alice",
      authorObjectId: "alice",
      authorKind: "llm",
    });

    // alice thread sync → 不写 inbox(self),但游标前进
    const before = world.aliceThread.inbox?.length ?? 0;
    await syncIssueWindowCommentsForTest(world.aliceThread, world.baseDir);
    expect(world.aliceThread.inbox?.length ?? 0).toBe(before);
    const w = world.aliceThread.contextWindows.find((x) => x.type === "issue");
    expect((w as IssueWindow).lastSeenCommentId).toBe(1);
  });

  test("mention 路径: @bob → bob inbox 收到", async () => {
    world = await setupWorld();
    await issuesService.appendComment({
      baseDir: world.baseDir,
      sessionId: "s1",
      issueId: world.issueId,
      text: "hi @bob",
      authorObjectId: "alice",
      authorKind: "llm",
    });

    await syncIssueWindowCommentsForTest(world.bobThread, world.baseDir);
    const msgs = world.bobThread.inbox ?? [];
    expect(msgs).toHaveLength(1);
    expect(msgs[0]?.content).toContain(`[issue:${world.issueId}:comment author=alice`);
    expect(msgs[0]?.content).toContain("hi @bob");
  });

  test("mention 路径: 不含 @bob → bob 不收(只前进游标)", async () => {
    world = await setupWorld();
    await issuesService.appendComment({
      baseDir: world.baseDir,
      sessionId: "s1",
      issueId: world.issueId,
      text: "讨论其它话题",
      authorObjectId: "alice",
      authorKind: "llm",
    });

    await syncIssueWindowCommentsForTest(world.bobThread, world.baseDir);
    expect(world.bobThread.inbox?.length ?? 0).toBe(0);
    const w = world.bobThread.contextWindows.find((x) => x.type === "issue");
    expect((w as IssueWindow).lastSeenCommentId).toBe(1);
  });

  test("非 wait 时 10s 限频: 第二条 @bob 在 10s 内被压制", async () => {
    world = await setupWorld();
    // 第一条 → 写 inbox + 设 lastNotifiedAt
    await issuesService.appendComment({
      baseDir: world.baseDir,
      sessionId: "s1",
      issueId: world.issueId,
      text: "hi @bob",
      authorObjectId: "alice",
      authorKind: "llm",
    });
    await syncIssueWindowCommentsForTest(world.bobThread, world.baseDir);
    expect(world.bobThread.inbox?.length ?? 0).toBe(1);

    // 第二条 < 10s 内 → 限频压制(但游标前进)
    await issuesService.appendComment({
      baseDir: world.baseDir,
      sessionId: "s1",
      issueId: world.issueId,
      text: "再 ping @bob",
      authorObjectId: "alice",
      authorKind: "llm",
    });
    await syncIssueWindowCommentsForTest(world.bobThread, world.baseDir);
    expect(world.bobThread.inbox?.length ?? 0).toBe(1); // 仍是 1 条
    const w = world.bobThread.contextWindows.find((x) => x.type === "issue");
    expect((w as IssueWindow).lastSeenCommentId).toBe(2); // 游标到 2
  });

  test("wait-all 模式: bob waiting+waitingOn=window → 绕过 10s 限频", async () => {
    world = await setupWorld();
    // 第一条 → 写 inbox + 设 lastNotifiedAt
    await issuesService.appendComment({
      baseDir: world.baseDir,
      sessionId: "s1",
      issueId: world.issueId,
      text: "hi @bob",
      authorObjectId: "alice",
      authorKind: "llm",
    });
    await syncIssueWindowCommentsForTest(world.bobThread, world.baseDir);
    expect(world.bobThread.inbox?.length ?? 0).toBe(1);

    // bob 切到 wait-all 模式(限频原本会压第二条;wait-all 路径绕过)
    world.bobThread.status = "waiting";
    world.bobThread.waitingOn = world.bobWindowId;
    world.bobThread.inboxSnapshotAtWait = world.bobThread.inbox?.length ?? 0;

    // 第二条 — 不含 @bob;wait-all 模式所有 newComment 都进 inbox
    await issuesService.appendComment({
      baseDir: world.baseDir,
      sessionId: "s1",
      issueId: world.issueId,
      text: "另一个评论",
      authorObjectId: "alice",
      authorKind: "llm",
    });
    await syncIssueWindowCommentsForTest(world.bobThread, world.baseDir);
    expect(world.bobThread.inbox?.length ?? 0).toBe(2); // wait-all 写入第二条
    // 提前翻 running(也由 sync 内 wakeWaitingThreadsOnInbox 替代逻辑)
    expect(world.bobThread.status as string).toBe("running");
  });

  test("Issue close fallback: bob 收 [closed] inbox + window 被移除", async () => {
    const w = (world = await setupWorld());
    await issuesService.closeIssue({
      baseDir: w.baseDir,
      sessionId: "s1",
      issueId: w.issueId,
    });
    await syncIssueWindowCommentsForTest(w.bobThread, w.baseDir);

    const msgs = w.bobThread.inbox ?? [];
    expect(msgs).toHaveLength(1);
    expect(msgs[0]?.content).toContain(`[issue:${w.issueId}:closed]`);
    // window 被移除
    const stillThere = w.bobThread.contextWindows.find(
      (x) => x.type === "issue" && (x as IssueWindow).issueId === w.issueId,
    );
    expect(stillThere).toBeUndefined();
  });

  test("findIssueSubscribers: 排除 author thread", async () => {
    world = await setupWorld();
    const subs = await findIssueSubscribers(world.baseDir, "s1", world.issueId, {
      exceptObjectId: "alice",
      exceptThreadId: "alice_t1",
    });
    expect(subs).toHaveLength(1);
    expect(subs[0]?.objectId).toBe("bob");
    expect(subs[0]?.threadId).toBe("bob_t1");
  });

  test("Issue 文件不存在 → sync 静默跳过,不抛错", async () => {
    world = await setupWorld();
    // 强行删除 issue 文件
    const { rm: rmFile } = await import("node:fs/promises");
    await rmFile(
      join(world.baseDir, "flows", "s1", "issues", `issue-${world.issueId}.json`),
    );
    // 不应抛
    await syncIssueWindowCommentsForTest(world.bobThread, world.baseDir);
    expect(world.bobThread.inbox?.length ?? 0).toBe(0);
  });

  test("无 IssueWindow → 无操作", async () => {
    world = await setupWorld();
    world.aliceThread.contextWindows = [];
    await syncIssueWindowCommentsForTest(world.aliceThread, world.baseDir);
    expect(world.aliceThread.inbox?.length ?? 0).toBe(0);
  });

  test("lastSeenCommentId 不持久化:writeThread + readThread 后字段被 strip", async () => {
    world = await setupWorld();
    // mutate window 加 lastSeenCommentId / lastNotifiedAt
    const w = world.bobThread.contextWindows.find((x) => x.type === "issue") as IssueWindow;
    w.lastSeenCommentId = 5;
    w.lastNotifiedAt = Date.now();
    await writeThread(world.bobThread);

    const reloaded = await readThread(
      { baseDir: world.baseDir, sessionId: "s1", objectId: "bob" },
      "bob_t1",
    );
    const rw = reloaded?.contextWindows.find((x) => x.type === "issue") as IssueWindow | undefined;
    expect(rw).toBeDefined();
    expect(rw?.lastSeenCommentId).toBeUndefined();
    expect(rw?.lastNotifiedAt).toBeUndefined();
  });
});
