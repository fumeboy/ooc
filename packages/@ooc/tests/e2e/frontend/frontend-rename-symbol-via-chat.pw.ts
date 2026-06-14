/**
 * F2 — frontend-rename-symbol-via-chat
 *
 * 类别：改文件（用户通过 web 让 assistant 改代码的核心体验）。
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
  // worker tick 把 status 从 running 翻到 done/waiting 需要时间；
  // 等 UI 显示回复后 status 不一定已收敛，给 15s polling 窗口让其稳定。
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let calleeThread: any = undefined;
  if (calleeThreadId) {
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      calleeThread = readThreadJson(ooc.backend.baseDir, "f2-rename", "assistant", calleeThreadId) as any;
      if (calleeThread?.status && calleeThread.status !== "running") break;
      await page.waitForTimeout(500);
    }
  }

  const finalContent = readFsState(ooc.backend.baseDir, FILE_PATH);
  const helperACount = countOccurrences(finalContent, "helperA");
  const helperZCount = countOccurrences(finalContent, "helperZ");

  // 检查 LLM 走过的 command 路径
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const events = (calleeThread?.events ?? []) as any[];
  const openCmds = events
    .filter((e) => e.category === "llm_interaction" && e.kind === "function_call" && e.toolName === "exec")
    .map((e) => (e.arguments?.method as string) ?? "")
    .filter(Boolean);
  // LLM 实际 exec 时 args.method 是单段命令名（无 window-type 前缀）：
  // file_window 上的 edit → "edit"，filesystem.write_file → "write_file"，terminal.run（bash）→ "run"。
  const usedFileWindowEdit = openCmds.includes("edit");
  const usedWriteFile = openCmds.includes("write_file");
  const usedShell = events.some((e) => {
    if (e.category !== "llm_interaction" || e.kind !== "function_call" || e.toolName !== "exec") return false;
    return e.arguments?.method === "run";
  });

  // 观察孔 B（thread state）：thread.contextWindows 中有 type=file 的 window 即证明走过 file_window 路径。
  // 改用 thread state 而非 .cw-row UI selector，避免 ContextSnapshotViewer 节点 label 文本漂移。
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fileWindowNodeCount = ((calleeThread?.contextWindows ?? []) as any[]).filter(
    (w) => w?.class === "file",
  ).length;

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
