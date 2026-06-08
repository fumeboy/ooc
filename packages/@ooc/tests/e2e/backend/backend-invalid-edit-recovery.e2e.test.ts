/**
 * S4 — backend-invalid-edit-recovery
 *
 * 类别：失败回路 — file_window.edit 的"唯一匹配"规则首次必失败；
 * 验 LLM 收到 fail-loud 错误后能扩大 old 上下文重试。
 * 详见 `docs/testing/oocable-codeagent-backend-e2e.md § S4`。
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

// 多处 `count = 0`，让 file_window.edit 首次按 `count = 0` 唯一匹配必失败。
const SEED_DUP = `// 第一处计数初始化
const count = 0;

function reset() {
  // 第二处
  let count = 0;
  return count;
}

function reset2() {
  // 第三处
  let count = 0;
  return count;
}
`;

describe.skipIf(!shouldRunBackendE2E)("[e2e backend] S4 invalid-edit-recovery", () => {
  let handle: AppHandle | undefined;

  beforeAll(() => {
    loadRealEnv();
  });

  afterEach(() => {
    handle?.cleanup();
    handle = undefined;
  });

  it.skipIf(!hasLlmEnv())(
    "首次 edit 'matches N times' 失败后，LLM 扩大 old 上下文重试成功",
    async () => {
      handle = await startApp({
        seedFiles: [{ path: "src/dup.ts", content: SEED_DUP }],
        seedStones: [
          {
            objectId: "assistant",
            self: "你是用户的 CodeAgent，遵循 OOC 协议；file_window.edit 不允许多重匹配，遇到 matches N times 错误时请扩大 old 包含足够上下文。",
          },
        ],
        workerMaxTicks: 40,
      });

      const seeded = await seedSession(handle.app, {
        sessionId: "s4-recover",
        targetObjectId: "assistant",
        initialMessage:
          "把 src/dup.ts 里【第一处】的 count = 0 改成 count = 1，其它出现的不要改。",
      });

      const job = await waitForJob(handle.app, seeded.jobId, { timeoutMs: 360_000 });
      const callee = await readCalleeThread(
        handle.baseDir,
        seeded.sessionId,
        seeded.targetObjectId,
        seeded.targetThreadId,
      );

      const finalDup = readFile(handle.baseDir, "src/dup.ts");

      // 第一处：const count = 0 → const count = 1
      const firstChanged = /\/\/ 第一处[\s\S]*?const\s+count\s*=\s*1/.test(finalDup);
      const secondPreserved = /reset\s*\(\)\s*{[\s\S]*?let\s+count\s*=\s*0/.test(finalDup);
      const thirdPreserved = /reset2\s*\(\)\s*{[\s\S]*?let\s+count\s*=\s*0/.test(finalDup);

      const editOpens = countMethodOpens(callee, "edit");
      const writeFileOpens = countMethodOpens(callee, "write_file");
      const usedShell = usedShellProgram(callee);
      const replies = assistantRepliesToUser(callee);
      const lastReply = replies[replies.length - 1]?.content ?? "";

      const result = scoreScenario({
        scenario: "S4 invalid-edit-recovery",
        bad: [
          { name: "thread 未跑完", check: () => callee?.status !== "done" && callee?.status !== "waiting" },
          { name: "assistant 没回复 user", check: () => replies.length === 0 || !lastReply.trim() },
          { name: "第一处没改成 count = 1", check: () => !firstChanged },
          { name: "第二处被误改", check: () => !secondPreserved },
          { name: "第三处被误改", check: () => !thirdPreserved },
          { name: "count = 0 总数 != 2（原 3 减 1）", check: () => countOccurrences(finalDup, "count = 0") !== 2 },
        ],
        good: [
          { name: "走 file_window.edit 完成（>= 2 次说明有重试）", check: () => editOpens >= 2 },
          { name: "未退化到 shell", check: () => !usedShell },
          { name: "未退化到 root.write_file 全覆盖", check: () => writeFileOpens === 0 },
          { name: "回复中解释了发生的事", check: () => lastReply.length >= 10 },
          { name: "edit 重试次数 < 4（说明 LLM 不是反复试错）", check: () => editOpens < 4 },
        ],
      });

      logScore(result, {
        jobStatus: job.status,
        threadStatus: callee?.status,
        editOpens,
        writeFileOpens,
        usedShell,
        firstChanged,
        secondPreserved,
        thirdPreserved,
        count0Remaining: countOccurrences(finalDup, "count = 0"),
        count1Total: countOccurrences(finalDup, "count = 1"),
        commandsUsed: listOpenedCommands(callee).slice(0, 40),
        lastReplyPreview: lastReply.slice(0, 200),
      });

      expect(result.tier).not.toBe("Bad");
    },
    480_000,
  );
});
