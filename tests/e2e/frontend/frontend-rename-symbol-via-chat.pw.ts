/**
 * F2 — frontend-rename-symbol-via-chat
 *
 * 类别：改文件（用户通过 web 让 assistant 改代码的核心体验）。
 * 详见 `docs/testing/oocable-codeagent-frontend-e2e.md § F2`。
 *
 * Seed 路径：work/src/foo.ts —— 与 backend S1 区分；后端 worker 由 startBackend 通过
 * --world <baseDir> 启动，所以相对路径以 baseDir 为根。
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

const SEED_FOO = `
export function helperA(value: number): number {
  return helperA(value - 1) + 1;
}
`.trimStart();
const FILE_PATH = "work/src/foo.ts";

test("F2 用户让 assistant 通过 chat 改文件 → fs 真改", async ({ page, ooc }) => {
  const consoleLog = collectConsoleErrors(page);

  await ooc.seedScenario({
    seedFiles: [{ path: FILE_PATH, content: SEED_FOO }],
    seedStones: [
      {
        objectId: "assistant",
        self: "你是用户的 CodeAgent，遵循 OOC 协议；改代码时优先用 file_window.edit。",
      },
    ],
  });

  const helperAInitial = countOccurrences(SEED_FOO, "helperA");

  await page.goto(ooc.web.url);
  await createSessionVia(page, {
    sessionId: "f2-rename",
    targetObjectId: "assistant",
    firstMessage:
      "请把 work/src/foo.ts 中的函数 helperA 重命名为 helperZ；改完告诉我做了什么。",
  });

  const replyCount = await waitForReply(page, { sinceCount: 0, timeoutMs: 240_000 }).catch(() => 0);

  const calleeThreadId = await discoverCalleeThreadId(ooc.backend.baseDir, "f2-rename", "assistant").catch(
    () => "",
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const calleeThread = calleeThreadId
    ? (readThreadJson(ooc.backend.baseDir, "f2-rename", "assistant", calleeThreadId) as any)
    : undefined;

  const finalContent = readFsState(ooc.backend.baseDir, FILE_PATH);
  const helperACount = countOccurrences(finalContent, "helperA");
  const helperZCount = countOccurrences(finalContent, "helperZ");

  // 检查 LLM 走过的 command 路径
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const events = (calleeThread?.events ?? []) as any[];
  const openCmds = events
    .filter((e) => e.category === "llm_interaction" && e.kind === "function_call" && e.toolName === "exec")
    .map((e) => (e.arguments?.command as string) ?? "")
    .filter(Boolean);
  const usedFileWindowEdit = openCmds.includes("file_window.edit");
  const usedWriteFile = openCmds.includes("root.write_file");
  const usedShell = events.some((e) => {
    if (e.category !== "llm_interaction" || e.kind !== "function_call" || e.toolName !== "exec") return false;
    if (e.arguments?.command !== "root.program") return false;
    const lang = (e.arguments?.args?.language ?? e.arguments?.args?.lang) as string | undefined;
    return lang === "shell";
  });

  // UI: ContextSnapshotViewer 中应能看到至少 1 个 file_window —— 走过 file_window 路径的证据
  const fileWindowNodeCount = await page
    .locator("[data-window-type='file'], .context-tree-node:has-text('file_window'), .context-tree-node:has-text('FILE')")
    .count();

  const result = scoreScenario({
    scenario: "F2 rename-symbol-via-chat",
    bad: [
      { name: "assistant 不回复 / UI 无更新", check: () => replyCount === 0 },
      { name: "thread 卡在 running", check: () => calleeThread?.status === "running" },
      { name: "helperA 仍存在", check: () => helperACount > 0 },
      { name: "helperZ 数量不对", check: () => helperZCount !== helperAInitial },
      { name: "浏览器 console.error", check: () => consoleLog.errors.length > 0 },
    ],
    good: [
      { name: "走过 file_window.edit", check: () => usedFileWindowEdit },
      { name: "未走 shell 改文件", check: () => !usedShell },
      { name: "未走 root.write_file 全覆盖", check: () => !usedWriteFile },
      { name: "ContextSnapshotViewer 出现 file_window 节点", check: () => fileWindowNodeCount > 0 },
    ],
  });

  logScore(result, {
    replyCount,
    helperAInitial,
    helperACount,
    helperZCount,
    threadStatus: calleeThread?.status,
    usedFileWindowEdit,
    usedWriteFile,
    usedShell,
    fileWindowNodeCount,
    openCmds: openCmds.slice(0, 30),
    consoleErrors: consoleLog.errors.length,
  });

  test.expect(result.tier).not.toBe("Bad");
});
