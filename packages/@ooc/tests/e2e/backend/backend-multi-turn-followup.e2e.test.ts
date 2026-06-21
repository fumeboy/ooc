/**
 * S3 — backend-multi-turn-followup
 *
 * 类别：多轮对话 — 验 cross-object talk 双写、talk_window 复用。
 */

import { afterEach, beforeAll, describe, expect, it } from "bun:test";
import {
  assistantRepliesToUser,
  continueThread,
  countOccurrences,
  hasLlmEnv,
  listOpenedCommands,
  loadRealEnv,
  logScore,
  readCalleeThread,
  readFile,
  readUserRootThread,
  scoreScenario,
  seedSession,
  shouldRunBackendE2E,
  startApp,
  type AppHandle,
  userInboxIntoCallee,
  userOutboxMessages,
  waitForJob,
} from "./_fixture";

const SEED_CALC = `export function add(a: number, b: number): number {
  return a + b;
}
`;

describe.skipIf(!shouldRunBackendE2E)("[e2e backend] S3 multi-turn-followup", () => {
  let handle: AppHandle | undefined;

  beforeAll(() => {
    loadRealEnv();
  });

  afterEach(() => {
    handle?.cleanup();
    handle = undefined;
  });

  it.skipIf(!hasLlmEnv())(
    "两轮对话：先问实现，再要 assistant 加 sub —— 双写一致且复用同一 talk_window",
    async () => {
      handle = await startApp({
        seedFiles: [{ path: "src/calc.ts", content: SEED_CALC }],
        seedStones: [
          {
            objectId: "assistant",
            self: "你是用户的 CodeAgent，遵循 OOC 协议；改代码用 file_window.edit。",
          },
        ],
        workerMaxTicks: 30,
      });

      // 轮 1
      const seeded = await seedSession(handle.app, {
        sessionId: "s3-multi",
        targetObjectId: "assistant",
        initialMessage: "src/calc.ts 里 add 是怎么实现的？",
      });
      const job1 = await waitForJob(handle.app, seeded.jobId, { timeoutMs: 240_000 });
      const calleeAfterTurn1 = await readCalleeThread(
        handle.baseDir,
        seeded.sessionId,
        seeded.targetObjectId,
        seeded.targetThreadId,
      );
      const turn1Replies = assistantRepliesToUser(calleeAfterTurn1);

      // 轮 2 —— 用 continueThread 复用 user.root 的 talk_window
      const cont = await continueThread(handle.app, seeded.sessionId, "那加一个 sub(a, b) 函数。");
      const job2 = await waitForJob(handle.app, cont.jobId, { timeoutMs: 240_000 });

      const calleeAfterTurn2 = await readCalleeThread(
        handle.baseDir,
        seeded.sessionId,
        seeded.targetObjectId,
        seeded.targetThreadId,
      );
      const userThread = await readUserRootThread(handle.baseDir, seeded.sessionId);

      const finalCalc = readFile(handle.baseDir, "src/calc.ts");
      const userOutbox = userOutboxMessages(userThread);
      const userIntoCallee = userInboxIntoCallee(calleeAfterTurn2);
      const replies = assistantRepliesToUser(calleeAfterTurn2);
      const turn1ReplyText = turn1Replies.map((m) => m.content).join("\n");
      const turn2ReplyText = replies.slice(turn1Replies.length).map((m) => m.content).join("\n");

      // 复用同一 talk_window：callee thread 自带的初始 creator talk_window 数应为 1
      const calleeTalkWindows =
        calleeAfterTurn2?.contextWindows?.filter((w) => w.object.class === "talk") ?? [];
      const reusedSameTalkWindow = calleeTalkWindows.length === 1;

      const result = scoreScenario({
        scenario: "S3 multi-turn-followup",
        bad: [
          { name: "轮 1 thread 没回复", check: () => turn1Replies.length === 0 },
          { name: "轮 2 thread 没新回复", check: () => replies.length <= turn1Replies.length },
          { name: "user.root.outbox 不是 2 条", check: () => userOutbox.length !== 2 },
          {
            name: "callee.inbox 中 source=user 数量与 user.root.outbox 不一致",
            check: () => userIntoCallee.length !== userOutbox.length,
          },
          { name: "src/calc.ts 中未出现 sub", check: () => !/function\s+sub/.test(finalCalc) && !/sub\s*=/.test(finalCalc) },
        ],
        good: [
          { name: "轮 1 回复提到 add 实现", check: () => /add/i.test(turn1ReplyText) },
          { name: "复用同一 talk_window（callee 只有 1 个 talk_window）", check: () => reusedSameTalkWindow },
          { name: "sub 实现含 a/b 参数", check: () => /sub\s*\([^)]*a[^)]*b[^)]*\)/.test(finalCalc) || /sub\s*=.*a.*b/.test(finalCalc) },
          { name: "保留了原 add 实现", check: () => countOccurrences(finalCalc, "function add") + countOccurrences(finalCalc, "const add") >= 1 },
        ],
      });

      logScore(result, {
        job1Status: job1.status,
        job2Status: job2.status,
        threadStatus: calleeAfterTurn2?.status,
        turn1Replies: turn1Replies.length,
        turn2Replies: replies.length - turn1Replies.length,
        userOutbox: userOutbox.length,
        userIntoCallee: userIntoCallee.length,
        calleeTalkWindows: calleeTalkWindows.length,
        commandsUsed: listOpenedCommands(calleeAfterTurn2).slice(0, 40),
        finalCalcPreview: finalCalc.slice(0, 300),
      });

      expect(result.tier).not.toBe("Bad");
    },
    480_000,
  );
});
