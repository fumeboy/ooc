/**
 * F4 — frontend-user-talk-window-composer
 *
 * 类别：UI 单点（验证 ContextSnapshotViewer 内 inline talk composer 真能用）。
 * 详见 `docs/testing/oocable-codeagent-frontend-e2e.md § F4`。
 */

import {
  collectConsoleErrors,
  createSessionVia,
  discoverCalleeThreadId,
  logScore,
  readThreadJson,
  scoreScenario,
  test,
  waitForReply,
} from "./_fixture";

test("F4 user.root.talk_window 详情内 inline composer 发出第二轮回复", async ({ page, ooc }) => {
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
    sessionId: "f4-inline",
    targetObjectId: "assistant",
    firstMessage: "hi",
  });
  await waitForReply(page, { sinceCount: 0, timeoutMs: 90_000 });

  // 切到 user.root —— 通过 ThreadHeader 的 .thread-switcher select
  // value 是 "objectId/threadId"
  await page.locator(".thread-switcher").selectOption("user/root");

  // 在 ContextSnapshotViewer 里找 target=assistant 的 talk_window 节点
  // 节点本身或其周围会含 "assistant" / "talk" 文本；点开后右侧出现 .llm-input-talk-composer
  await page
    .locator(".context-tree-node:has-text('talk'), [data-window-type='talk']")
    .first()
    .click();

  await page.locator(".llm-input-talk-composer").waitFor({ state: "visible", timeout: 10_000 });
  const composerVisible = await page.locator(".llm-input-talk-composer-input").isVisible();
  const composerEnabled = await page.locator(".llm-input-talk-composer-input").isEnabled();

  const startedAt = Date.now();
  await page.locator(".llm-input-talk-composer-input").fill("再说一句");
  await page.locator(".llm-input-talk-composer-btn").click();

  // 等 60 秒看是否出现第二条 assistant 回复
  let secondReplyDeadline = Date.now() + 60_000;
  let sawSecondReply = false;
  while (Date.now() < secondReplyDeadline) {
    // assistant 第二条回复会以 .timeline-message / talk transcript 形式出现
    const count = await page
      .locator(".timeline-message, .talk-transcript-message, .chat-timeline .message")
      .count();
    if (count >= 3) {
      sawSecondReply = true;
      break;
    }
    await page.waitForTimeout(1000);
  }
  const elapsedMs = Date.now() - startedAt;

  // FS 侧观察
  const calleeThreadId = await discoverCalleeThreadId(ooc.backend.baseDir, "f4-inline", "assistant").catch(
    () => "",
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const userThread = (() => {
    try {
      return readThreadJson(ooc.backend.baseDir, "f4-inline", "user", "root") as any;
    } catch {
      return undefined;
    }
  })();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const calleeThread = calleeThreadId
    ? (readThreadJson(ooc.backend.baseDir, "f4-inline", "assistant", calleeThreadId) as any)
    : undefined;

  const userOutboxLen = Array.isArray(userThread?.outbox) ? userThread.outbox.length : 0;
  const userIntoCalleeLen =
    calleeThread?.inbox?.filter((m: any) => m.source === "user").length ?? 0;

  const result = scoreScenario({
    scenario: "F4 user-talk-window-composer",
    bad: [
      { name: "inline composer 不可见", check: () => !composerVisible },
      { name: "inline composer 被禁用", check: () => !composerEnabled },
      { name: "Send 后无第二条 assistant 回复", check: () => !sawSecondReply },
      { name: "浏览器 console.error", check: () => consoleLog.errors.length > 0 },
    ],
    good: [
      { name: "30 秒内出现第二条回复", check: () => sawSecondReply && elapsedMs <= 30_000 },
      { name: "user.root.outbox 长度 = 2", check: () => userOutboxLen === 2 },
      { name: "callee.inbox 中 source=user 数量 = 2", check: () => userIntoCalleeLen === 2 },
    ],
  });

  logScore(result, {
    elapsedMs,
    composerVisible,
    composerEnabled,
    sawSecondReply,
    userOutboxLen,
    userIntoCalleeLen,
    consoleErrors: consoleLog.errors.length,
  });

  test.expect(result.tier).not.toBe("Bad");
});
