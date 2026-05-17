/**
 * F5 — frontend-no-right-panel-on-user-thread
 *
 * 类别：UI layout 守护——切到 user.root 时右侧 chat panel 应消失，
 * 中间 MainPanel 占据原右侧空间。
 * 详见 `docs/testing/oocable-codeagent-frontend-e2e.md § F5`。
 */

import {
  collectConsoleErrors,
  createSessionVia,
  logScore,
  scoreScenario,
  test,
  waitForReply,
} from "./_fixture";

test("F5 切到 user.root 后右侧 chat panel 不应可见", async ({ page, ooc }) => {
  const consoleLog = collectConsoleErrors(page);

  await ooc.seedScenario({
    seedStones: [
      {
        objectId: "assistant",
        self: "你是用户的 CodeAgent。",
      },
    ],
  });

  await page.goto(ooc.web.url);
  await createSessionVia(page, {
    sessionId: "f5-no-right",
    targetObjectId: "assistant",
    firstMessage: "hi",
  });
  await waitForReply(page, { sinceCount: 0, timeoutMs: 90_000 });

  // 切到 user.root
  await page.locator(".thread-switcher").selectOption("user/root");
  await page.waitForTimeout(500);

  const rightPanelLocator = page.locator(".right-panel");
  const rightPanelInDom = (await rightPanelLocator.count()) > 0;
  // 是否处于 hidden（CSS display:none / visibility:hidden / 0 高宽 / aria-hidden）
  const rightPanelVisible = rightPanelInDom ? await rightPanelLocator.isVisible() : false;
  const layoutNoRight = (await page.locator(".app-layout-no-right").count()) > 0;
  // ChatComposer（user 与自己对话的破口）不应出现
  const chatComposerVisible = await page.locator(".chat-composer").isVisible().catch(() => false);
  // ThreadHeader（仍可见）
  const threadHeaderVisible = await page.locator(".thread-header").isVisible().catch(() => false);

  const result = scoreScenario({
    scenario: "F5 no-right-panel-on-user-thread",
    bad: [
      { name: "ChatComposer 出现（user 跟自己对话的 UX 漏洞）", check: () => chatComposerVisible },
      { name: "右侧 panel 可见", check: () => rightPanelVisible },
      { name: "浏览器 console.error", check: () => consoleLog.errors.length > 0 },
    ],
    good: [
      { name: "right-panel 不在 DOM 中（彻底移除而非 CSS 隐藏）", check: () => !rightPanelInDom },
      { name: "layout 切到 app-layout-no-right", check: () => layoutNoRight },
      { name: "ThreadHeader 仍可见", check: () => threadHeaderVisible },
    ],
  });

  logScore(result, {
    rightPanelInDom,
    rightPanelVisible,
    layoutNoRight,
    chatComposerVisible,
    threadHeaderVisible,
    consoleErrors: consoleLog.errors.length,
  });

  test.expect(result.tier).not.toBe("Bad");
});
