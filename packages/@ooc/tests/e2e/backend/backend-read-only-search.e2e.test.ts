/**
 * S2 — backend-read-only-search
 *
 * 类别：纯读取（验 root.grep 真链路 + 文件零修改）。
 * 详见 `docs/testing/oocable-codeagent-backend-e2e.md § S2`。
 */

import { afterEach, beforeAll, describe, expect, it } from "bun:test";
import {
  assistantRepliesToUser,
  countMethodOpens,
  countOccurrences,
  hasLlmEnv,
  listOpenedCommands,
  loadRealEnv,
  logScore,
  readCalleeThread,
  readFile,
  scoreScenario,
  seedSession,
  shouldRunBackendE2E,
  startApp,
  type AppHandle,
  usedShellProgram,
  waitForJob,
} from "./_fixture";

const SEED = {
  a: `// 已被遗弃的 helper；不要在新代码里用。
export function useA() {
  return deprecatedFoo() + 1;
}
`,
  b: `import { deprecatedFoo } from "./a";

export function callB() {
  return deprecatedFoo();
}
`,
  c: `export function callC() {
  // 这里也调了 deprecatedFoo
  return deprecatedFoo() * 2;
}
`,
};

// 已知出现次数：a 中 1，b 中 2，c 中 2 = 5
const EXPECTED_DEPRECATED_COUNT = 5;

describe.skipIf(!shouldRunBackendE2E)("[e2e backend] S2 read-only-search", () => {
  let handle: AppHandle | undefined;

  beforeAll(() => {
    loadRealEnv();
  });

  afterEach(() => {
    handle?.cleanup();
    handle = undefined;
  });

  it.skipIf(!hasLlmEnv())(
    "LLM 用 root.grep 找全部 deprecatedFoo 引用并报数，不动文件",
    async () => {
      handle = await startApp({
        seedFiles: [
          { path: "src/a.ts", content: SEED.a },
          { path: "src/b.ts", content: SEED.b },
          { path: "src/c.ts", content: SEED.c },
        ],
        seedStones: [
          {
            objectId: "assistant",
            self: "你是用户的 CodeAgent，遵循 OOC 协议；搜索代码请用 root.grep。",
          },
        ],
        workerMaxTicks: 25,
      });

      const seedSnapshots = {
        a: readFile(handle.baseDir, "src/a.ts"),
        b: readFile(handle.baseDir, "src/b.ts"),
        c: readFile(handle.baseDir, "src/c.ts"),
      };

      const seeded = await seedSession(handle.app, {
        sessionId: "s2-search",
        targetObjectId: "assistant",
        initialMessage:
          "找出 src/ 下所有用到 deprecatedFoo 的位置，告诉我有几处、分别在什么文件什么行。不要修改代码。",
      });

      const job = await waitForJob(handle.app, seeded.jobId, { timeoutMs: 240_000 });
      const callee = await readCalleeThread(
        handle.baseDir,
        seeded.sessionId,
        seeded.targetObjectId,
        seeded.targetThreadId,
      );

      const finalSnapshots = {
        a: readFile(handle.baseDir, "src/a.ts"),
        b: readFile(handle.baseDir, "src/b.ts"),
        c: readFile(handle.baseDir, "src/c.ts"),
      };
      const filesUnchanged =
        finalSnapshots.a === seedSnapshots.a &&
        finalSnapshots.b === seedSnapshots.b &&
        finalSnapshots.c === seedSnapshots.c;

      const replies = assistantRepliesToUser(callee);
      const lastReply = replies[replies.length - 1]?.content ?? "";
      const grepOpens = countMethodOpens(callee, "grep");
      const editOpens = countMethodOpens(callee, "edit");
      const writeFileOpens = countMethodOpens(callee, "write_file");
      const usedShell = usedShellProgram(callee);
      const reportedExpected = lastReply.includes(String(EXPECTED_DEPRECATED_COUNT));

      const result = scoreScenario({
        scenario: "S2 read-only-search",
        bad: [
          { name: "thread 未跑完", check: () => callee?.status !== "done" && callee?.status !== "waiting" },
          { name: "assistant 无回复", check: () => replies.length === 0 || !lastReply.trim() },
          { name: "文件被修改", check: () => !filesUnchanged },
          { name: "回复中无正确数字", check: () => !reportedExpected },
        ],
        good: [
          { name: "至少 open 过 1 次 root.grep", check: () => grepOpens >= 1 },
          { name: "未走 shell", check: () => !usedShell },
          { name: "未 open file_window.edit", check: () => editOpens === 0 },
          { name: "未 open root.write_file", check: () => writeFileOpens === 0 },
          {
            name: "回复中至少引用一个文件名",
            check: () => /(a|b|c)\.ts/.test(lastReply),
          },
        ],
      });

      logScore(result, {
        jobStatus: job.status,
        threadStatus: callee?.status,
        expectedCount: EXPECTED_DEPRECATED_COUNT,
        actualCountInSeed:
          countOccurrences(SEED.a + SEED.b + SEED.c, "deprecatedFoo"),
        grepOpens,
        editOpens,
        writeFileOpens,
        usedShell,
        filesUnchanged,
        commandsUsed: listOpenedCommands(callee).slice(0, 30),
        lastReplyPreview: lastReply.slice(0, 200),
      });

      expect(result.tier).not.toBe("Bad");
    },
    300_000,
  );
});
