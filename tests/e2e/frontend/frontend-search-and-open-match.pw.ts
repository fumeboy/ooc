/**
 * F3 — frontend-search-and-open-match
 *
 * 类别：纯读取 + UI 副作用（search_window 真渲染）。
 * 详见 `docs/testing/oocable-codeagent-frontend-e2e.md § F3`。
 */

import {
  collectConsoleErrors,
  countOccurrences,
  createSessionVia,
  discoverCalleeThreadId,
  logScore,
  readFsState,
  readThreadJson,
  scoreScenario,
  test,
  waitForReply,
} from "./_fixture";

const SEED = {
  a: `export const useA = () => deprecatedFoo();\n`,
  b: `import { deprecatedFoo } from "./a";\nexport const callB = () => deprecatedFoo() + deprecatedFoo();\n`,
  c: `export const callC = () => deprecatedFoo() * 2;\n// deprecatedFoo 之后会被删\n`,
};
// 已知出现次数：a 1 + b 2 + c 2 = 5
const EXPECTED_COUNT = 5;

test("F3 grep → search_window 出现在 ContextSnapshotViewer", async ({ page, ooc }) => {
  const consoleLog = collectConsoleErrors(page);

  await ooc.seedScenario({
    seedFiles: [
      { path: "work/src/a.ts", content: SEED.a },
      { path: "work/src/b.ts", content: SEED.b },
      { path: "work/src/c.ts", content: SEED.c },
    ],
    seedStones: [
      {
        objectId: "assistant",
        self: "你是用户的 CodeAgent；搜代码请用 root.grep。",
      },
    ],
  });

  await page.goto(ooc.web.url);
  await createSessionVia(page, {
    sessionId: "f3-search",
    targetObjectId: "assistant",
    firstMessage:
      "找出 work/src/ 下所有用到 deprecatedFoo 的位置，告诉我有几处。不要修改代码。",
  });

  const replyCount = await waitForReply(page, { sinceCount: 0, timeoutMs: 180_000 }).catch(() => 0);

  const calleeThreadId = await discoverCalleeThreadId(ooc.backend.baseDir, "f3-search", "assistant").catch(
    () => "",
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const calleeThread = calleeThreadId
    ? (readThreadJson(ooc.backend.baseDir, "f3-search", "assistant", calleeThreadId) as any)
    : undefined;

  const filesUnchanged =
    readFsState(ooc.backend.baseDir, "work/src/a.ts") === SEED.a &&
    readFsState(ooc.backend.baseDir, "work/src/b.ts") === SEED.b &&
    readFsState(ooc.backend.baseDir, "work/src/c.ts") === SEED.c;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const events = (calleeThread?.events ?? []) as any[];
  // LLM 实际 exec 时 args.command 是单段命令名（无 window-type 前缀）：
  // root 上的 grep → "grep"。
  const usedGrep = events.some(
    (e) =>
      e.category === "llm_interaction" &&
      e.kind === "function_call" &&
      e.toolName === "exec" &&
      e.arguments?.command === "grep",
  );

  // 观察孔 B（thread state）：thread.contextWindows 中有 type=search 的 window 即证明走过 grep 路径。
  // 改用 thread state 而非 .cw-row UI selector，避免 ContextSnapshotViewer 节点 label 文本漂移。
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const searchWindowCount = ((calleeThread?.contextWindows ?? []) as any[]).filter(
    (w) => w?.type === "search",
  ).length;

  // assistant 文本中是否含正确数字
  // 真 DOM 锚（Round 17 后）：.chat-timeline .tui-block.tui-assistant（web/src/domains/chat/components/TuiBlock.tsx:9-13,455）
  const lastReplyText = (await page
    .locator(".chat-timeline .tui-block.tui-assistant")
    .last()
    .textContent()) ?? "";
  const reportedExpected = lastReplyText.includes(String(EXPECTED_COUNT));

  const result = scoreScenario({
    scenario: "F3 search-and-open-match",
    bad: [
      { name: "无回复", check: () => replyCount === 0 },
      { name: "数字错（未提到 5）", check: () => !reportedExpected },
      { name: "文件被修改", check: () => !filesUnchanged },
      { name: "浏览器 console.error", check: () => consoleLog.errors.length > 0 },
    ],
    good: [
      { name: "走过 root.grep", check: () => usedGrep },
      { name: "ContextSnapshotViewer 含 search_window 节点", check: () => searchWindowCount > 0 },
      { name: "回复至少引用一个文件名", check: () => /(a|b|c)\.ts/.test(lastReplyText) },
    ],
  });

  logScore(result, {
    replyCount,
    expectedCount: EXPECTED_COUNT,
    actualSeedCount: countOccurrences(SEED.a + SEED.b + SEED.c, "deprecatedFoo"),
    usedGrep,
    searchWindowCount,
    filesUnchanged,
    reportedExpected,
    threadStatus: calleeThread?.status,
    consoleErrors: consoleLog.errors.length,
    lastReplyPreview: lastReplyText.slice(0, 200),
  });

  test.expect(result.tier).not.toBe("Bad");
});
