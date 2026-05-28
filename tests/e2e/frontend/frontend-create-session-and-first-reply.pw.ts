/**
 * F1 — frontend-create-session-and-first-reply
 *
 * 类别：多轮对话起点。
 * 详见 `docs/testing/oocable-codeagent-frontend-e2e.md § F1`。
 */

import {
  collectConsoleErrors,
  countOccurrences,
  createSessionVia,
  discoverCalleeThreadId,
  logScore,
  readThreadJson,
  scoreScenario,
  test,
  waitForReply,
} from "./_fixture";

test("F1 SessionCreator → 首条 assistant 回复出现在 chat panel", async ({ page, ooc }) => {
  const startedAt = Date.now();
  const consoleLog = collectConsoleErrors(page);

  await ooc.seedScenario({
    seedStones: [
      {
        objectId: "assistant",
        self: "你是用户的 CodeAgent，遵循 OOC 协议。",
      },
    ],
  });

  await page.goto(ooc.web.url);

  await createSessionVia(page, {
    sessionId: "f1-first-reply",
    targetObjectId: "assistant",
    firstMessage: "hi",
  });

  const replyCount = await waitForReply(page, { sinceCount: 0, timeoutMs: 60_000 }).catch(() => 0);
  const elapsedMs = Date.now() - startedAt;

  // 在磁盘上观察 OOC 机制
  const calleeThreadId = await discoverCalleeThreadId(ooc.backend.baseDir, "f1-first-reply", "assistant").catch(
    () => "",
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const calleeThread = calleeThreadId
    ? (readThreadJson(ooc.backend.baseDir, "f1-first-reply", "assistant", calleeThreadId) as any)
    : undefined;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const userThread = (() => {
    try {
      return readThreadJson(ooc.backend.baseDir, "f1-first-reply", "user", "root") as any;
    } catch {
      return undefined;
    }
  })();

  const userOutboxHasHi = Array.isArray(userThread?.outbox) && userThread.outbox.some((m: any) => m.content === "hi");
  const calleeInboxHasReply =
    Array.isArray(calleeThread?.inbox) &&
    calleeThread.inbox.some((m: any) => typeof m.content === "string" && m.content.length > 0);
  const calleeOutboxHasReply =
    Array.isArray(calleeThread?.outbox) && (calleeThread.outbox?.length ?? 0) > 0;
  const calleeStatusOk = calleeThread?.status === "done" || calleeThread?.status === "waiting";
  const replyVisible = replyCount > 0;

  // ChatPanel timeline 至少 2 条 message（user hi + assistant 一句）。
  // Round 17 后 DOM：.chat-timeline > .tui-thread > .tui-block.tui-{user|assistant}。
  const transcriptCount = await page
    .locator(".chat-timeline .tui-block.tui-user, .chat-timeline .tui-block.tui-assistant")
    .count();

  const result = scoreScenario({
    scenario: "F1 create-session-and-first-reply",
    bad: [
      { name: "30 秒内 chat panel 无回复", check: () => !replyVisible && elapsedMs > 30_000 },
      { name: "DOM 无 assistant 回复元素（即使 60s）", check: () => !replyVisible },
      { name: "浏览器 console.error", check: () => consoleLog.errors.length > 0 },
      { name: "user.root.outbox 不含 hi", check: () => !userOutboxHasHi },
    ],
    good: [
      { name: "30 秒内出现回复", check: () => replyVisible && elapsedMs <= 30_000 },
      { name: "callee thread.status = done/waiting", check: () => calleeStatusOk },
      { name: "callee.inbox 含 user 的 hi", check: () => calleeInboxHasReply },
      { name: "callee.outbox 含 assistant 回复", check: () => calleeOutboxHasReply },
      { name: "transcript 至少 2 条", check: () => transcriptCount >= 2 },
      { name: "浏览器无 warning", check: () => consoleLog.warnings.length === 0 },
    ],
  });

  logScore(result, {
    elapsedMs,
    replyCount,
    transcriptCount,
    calleeStatus: calleeThread?.status,
    userOutboxLen: userThread?.outbox?.length ?? 0,
    calleeInboxLen: calleeThread?.inbox?.length ?? 0,
    calleeOutboxLen: calleeThread?.outbox?.length ?? 0,
    consoleErrors: consoleLog.errors.length,
    consoleWarnings: consoleLog.warnings.length,
    hiCount: userThread ? countOccurrences(JSON.stringify(userThread.outbox ?? []), "hi") : 0,
  });

  test.expect(result.tier).not.toBe("Bad");
});
