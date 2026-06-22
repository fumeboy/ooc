/**
 * S1 — backend-rename-symbol-via-edit
 *
 * 类别：改文件（核心 CodeAgent 体验）。
 *
 * Seed: baseDir/src/foo.ts 含 helperA / helperB，互相调用一次。
 * User msg: 让 assistant 把 helperA 重命名为 helperZ，回告做了什么。
 */

import { afterEach, beforeAll, describe, expect, it } from "bun:test";
import {
  assistantRepliesToUser,
  continueThread,
  countOccurrences,
  hasLlmEnv,
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
  countMethodOpens,
  listOpenedCommands,
  waitForJob,
} from "./_fixture";

const SEED_FOO = `
export function helperA(value: number): number {
  return helperB(value) + 1;
}

export function helperB(value: number): number {
  return helperA(value - 1) * 2;
}
`.trimStart();

describe.skipIf(!shouldRunBackendE2E)("[e2e backend] S1 rename-symbol-via-edit", () => {
  let handle: AppHandle | undefined;

  beforeAll(() => {
    loadRealEnv();
  });

  afterEach(() => {
    handle?.cleanup();
    handle = undefined;
  });

  it.skipIf(!hasLlmEnv())(
    "LLM 用 file_window.edit 完成跨函数重命名并回告 user",
    async () => {
      const relPath = "work/src/foo.ts";
      handle = await startApp({
        seedFiles: [{ path: relPath, content: SEED_FOO }],
        seedStones: [
          {
            objectId: "assistant",
            self: "你是用户的 CodeAgent，遵循 OOC 协议；改代码时优先用 file_window.edit。",
          },
        ],
        workerMaxTicks: 30,
      });
      // OOC 的 file_window / grep 当前用 process.cwd() 解析相对路径；e2e 隔离 baseDir
      // 不在 cwd 下，必须把绝对路径喂给 LLM。
      const absPath = `${handle.baseDir}/${relPath}`;

      const helperAInitial = countOccurrences(SEED_FOO, "helperA");
      expect(helperAInitial).toBeGreaterThan(0);

      const seeded = await seedSession(handle.app, {
        sessionId: "s1-rename",
        targetObjectId: "assistant",
        initialMessage:
          `请把 ${absPath} 中的函数 helperA 重命名为 helperZ；其它调用点也跟着改。改完告诉我做了什么。`,
      });

      const job = await waitForJob(handle.app, seeded.jobId, { timeoutMs: 240_000 });
      expect(["done", "failed"]).toContain(job.status);

      const callee = await readCalleeThread(
        handle.baseDir,
        seeded.sessionId,
        seeded.targetObjectId,
        seeded.targetThreadId,
      );

      const finalFoo = readFile(handle.baseDir, relPath);
      const helperACount = countOccurrences(finalFoo, "helperA");
      const helperZCount = countOccurrences(finalFoo, "helperZ");
      const replies = assistantRepliesToUser(callee);
      const lastReply = replies[replies.length - 1]?.content ?? "";
      const editOpens = countMethodOpens(callee, "edit");
      const writeFileOpens = countMethodOpens(callee, "write_file");
      const usedShell = usedShellProgram(callee);

      const result = scoreScenario({
        scenario: "S1 rename-symbol-via-edit",
        bad: [
          { name: "thread 未跑完", check: () => callee?.status !== "done" && callee?.status !== "waiting" },
          { name: "helperA 仍存在", check: () => helperACount > 0 },
          { name: "helperZ 数量不匹配 helperA 原数量", check: () => helperZCount !== helperAInitial },
          { name: "assistant 无回复", check: () => replies.length === 0 || !lastReply.trim() },
        ],
        good: [
          { name: "file_window.edit 至少 open 过 1 次", check: () => editOpens >= 1 },
          { name: "未走 shell 改文件", check: () => !usedShell },
          { name: "未用 root.write_file 全覆盖", check: () => writeFileOpens === 0 },
          { name: "回复中提到 helperZ", check: () => lastReply.includes("helperZ") },
          { name: "file_window.edit 重试 < 2 次", check: () => editOpens < 2 },
        ],
      });

      logScore(result, {
        jobStatus: job.status,
        threadStatus: callee?.status,
        helperAInitial,
        helperACount,
        helperZCount,
        editOpens,
        writeFileOpens,
        usedShell,
        commandsUsed: listOpenedCommands(callee).slice(0, 30),
        lastReplyPreview: lastReply.slice(0, 200),
      });

      if (result.tier === "Bad") {
        const last = (callee?.events ?? []).slice(-20);
        // eslint-disable-next-line no-console
        console.error("[e2e debug] last 20 events:", JSON.stringify(last, null, 2));
        // eslint-disable-next-line no-console
        console.error("[e2e debug] callee.outbox:", JSON.stringify(callee?.outbox ?? [], null, 2));
        // eslint-disable-next-line no-console
        console.error("[e2e debug] callee.contextWindows.types:", (callee?.contextWindows ?? []).map((w) => `${w.class}#${w.id}@${w.status}`));
      }
      expect(result.tier).not.toBe("Bad");
    },
    300_000,
  );
});
