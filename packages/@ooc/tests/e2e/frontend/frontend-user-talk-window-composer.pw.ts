/**
 * F4 — frontend-user-talk-window-composer
 *
 * 类别：UI 单点（验证 ContextSnapshotViewer 内 inline talk composer 真能用）。
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

  // 切到 user.root thread_context 视图：
  // path=/flows/thread_context 决定 view，query 带 sessionId/objectId/threadId。
  // ThreadHeader 的 .thread-switcher 主动过滤 user/root（ThreadHeader.tsx:31-33），
  // 所以不能 selectOption 切，要直接 navigate。
  const currentUrl = new URL(page.url());
  currentUrl.pathname = "/flows/thread_context";
  currentUrl.searchParams.set("objectId", "user");
  currentUrl.searchParams.set("threadId", "root");
  await page.goto(currentUrl.toString());
  await page.waitForTimeout(500);

  // 在 ContextSnapshotViewer 里找 target=assistant 的 talk_window 节点（DOM 锚：
  // web/src/domains/files/components/ContextSnapshotViewer.tsx:200 .cw-row + data-cw-node-id）
  // node.label 是 type（"talk"），summary 含 target=assistant，所以 row 文本里既有 talk 也有 assistant。
  const talkRows = page.locator(".cw-row:has-text('talk')");
  const talkRowCount = await talkRows.count();
  // 优先选含 'assistant' 的 talk row（target=assistant 的 talk_window）
  const targetTalkRow = page.locator(".cw-row:has-text('talk'):has-text('assistant')").first();
  const targetExists = (await targetTalkRow.count()) > 0;
  if (targetExists) {
    await targetTalkRow.click();
  } else if (talkRowCount > 0) {
    await talkRows.first().click();
  }

  await page.locator(".llm-input-talk-composer").waitFor({ state: "visible", timeout: 10_000 }).catch(() => undefined);
  const composerVisible = await page.locator(".llm-input-talk-composer-input").isVisible();
  const composerEnabled = await page.locator(".llm-input-talk-composer-input").isEnabled();

  const startedAt = Date.now();
  // composer 不可见时跳过填写（评分系统会按 composerVisible=false 判 Bad）
  if (composerVisible) {
    await page.locator(".llm-input-talk-composer-input").fill("再说一句");
    await page.locator(".llm-input-talk-composer-btn").click();
  }

  // 等 60 秒看是否出现第二条 assistant 回复。
  // user.root view + 已点开 talk_window：spec 期望第二回复在 ContextSnapshotViewer 的
  // talk_window transcript 内可见（ContextSnapshotViewer.tsx:1246-1268 .llm-input-transcript-list .llm-input-transcript-item）。
  // 一发一收 = 2 条，第二回复出现后 transcript >= 3。
  let secondReplyDeadline = Date.now() + 60_000;
  let sawSecondReply = false;
  while (Date.now() < secondReplyDeadline) {
    const transcriptCount = await page
      .locator(".llm-input-transcript-list .llm-input-transcript-item")
      .count();
    if (transcriptCount >= 3) {
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
    talkRowCount,
    targetExists,
    composerVisible,
    composerEnabled,
    sawSecondReply,
    userOutboxLen,
    userIntoCalleeLen,
    consoleErrors: consoleLog.errors.length,
  });

  test.expect(result.tier).not.toBe("Bad");
});
