/**
 * S(L5c) — agent↔agent wait/wake 双向往返安全网
 *
 * 这是 L5c talk 塌缩的**唯一关键路径测试网**：验证一个 agent 经 talk 向另一个 agent
 * 发消息并 wait=true → 对端 agent 收到、回复/end → caller agent 从 waiting 唤醒转 running。
 *
 * 为什么必须有：现有 backend-multi-turn-followup 只测 user→assistant 单向；agent↔agent
 * 路径（caller 是真 LLM agent 而非被动 user object）会经过两条会**静默断**的链路：
 *   1. caller agent `talk(target=callee, content, wait=true)` → status=waiting（window-free，OOC-4 L5c Phase C）
 *   2. callee agent 回复（`talk(target=caller, content)`）/ end → caller 唤醒
 *      （worker.ts:syncCrossObjectCalleeEnds 读 talks.json 路由的 cross-object end-sync，
 *       或 deliverMessage 写 caller.inbox + scheduler wakeWaitingThreadsOnInbox）
 * talk 塌缩后这两条链路若没改对，caller 会**永久卡死 waiting**——本测试是唯一网兜。
 *
 * 评分（per meta/engineering/how_to_test/strategy.md §2）：
 * - Bad：caller 没向 callee 发出消息 / callee 没收到 / caller 卡死 waiting 从未唤醒
 * - Good：caller waiting→running 转换可观察 + caller 收到 callee 回复 + 双向消息一致
 *
 * 单跑：
 *   RUN_BACKEND_E2E=1 NO_PROXY=localhost,127.0.0.1,::1 \
 *     bun test tests/e2e/backend/agent-to-agent-wait-wake.e2e.test.ts
 */

import { afterEach, beforeAll, describe, expect, it } from "bun:test";
import type { ProcessEvent, ThreadContext } from "@src/thinkable/context";
import {
  hasLlmEnv,
  listOpenedCommands,
  loadRealEnv,
  logScore,
  readCalleeThread,
  scoreScenario,
  seedSession,
  shouldRunBackendE2E,
  startApp,
  type AppHandle,
} from "./_fixture";

const COORDINATOR_SELF = `你是 coordinator，一个协调员 agent，遵循 OOC 协议。
当用户要你向另一个对象问问题时：
1. 用一次 talk(target=对方 objectId, content="<问题>", wait=true) 把问题发给对方并等回信。
2. 收到对方回信后，用 talk(target="user", content="<答案>") 把答案转告 user，然后 end。
不要自己编造答案——必须真的去问对方。不要创建/操作任何 talk_window——直接用 talk method 发消息。`;

const HELPER_SELF = `你是 helper，一个知识 agent，遵循 OOC 协议。
当有别的 agent 问你问题时（inbox 里会出现对方消息，from 是对方 objectId），
用一次 talk(target=对方 objectId, content="<回答>") 直接回答，然后 end。
你知道的事实：OOC 项目的吉祥物是一只叫 "Stone" 的石头。回答要包含 "Stone" 这个名字。`;

/**
 * 从 thread.events 判断是否出现过 waiting 状态转换。
 * thinkloop 会在 status 翻转时落 event；这里宽松匹配任何含 "wait" 的 context_change，
 * 同时也接受运行时观察到的终态作为辅证。
 */
function sawWaiting(thread: ThreadContext | undefined): boolean {
  if (!thread) return false;
  // inboxSnapshotAtWait 被设过的痕迹：caller say(wait) 一定先进 waiting。
  // 直接证据：events 里是否出现过 status 相关的 waiting 标记。
  for (const e of thread.events as ProcessEvent[]) {
    const text = JSON.stringify(e);
    if (text.includes("waiting")) return true;
  }
  return false;
}

/** caller.inbox 中由 callee（helper）发来的回信（source=talk 且 fromObjectId=helper）。 */
function repliesFromHelper(callerThread: ThreadContext | undefined): number {
  if (!callerThread?.inbox) return 0;
  return callerThread.inbox.filter(
    (m) => m.fromObjectId === "helper" || (m.source === "talk" && m.toThreadId === callerThread.id),
  ).length;
}

describe.skipIf(!shouldRunBackendE2E)("[e2e backend] agent↔agent wait/wake round-trip", () => {
  let handle: AppHandle | undefined;

  beforeAll(() => {
    loadRealEnv();
  });

  afterEach(() => {
    handle?.cleanup();
    handle = undefined;
  });

  it.skipIf(!hasLlmEnv())(
    "coordinator talk→helper(wait) → helper 回复 → coordinator 从 waiting 唤醒并回报 user",
    async () => {
      handle = await startApp({
        seedStones: [
          { objectId: "coordinator", self: COORDINATOR_SELF },
          { objectId: "helper", self: HELPER_SELF },
        ],
        // 必须迁移扁平 seed stone 到 stones/main/objects/<id>/——root.talk 的 target
        // 校验走 stoneDir()（指向 stones/main/objects/<target>/），否则 coordinator
        // talk(target="helper") 会因"stones/helper/ 未找到"被拒，agent↔agent 链路根本起不来。
        bootstrapStoneRepo: true,
        workerMaxTicks: 30,
      });

      // user → coordinator：要 coordinator 去问 helper，然后把答案带回来
      const seeded = await seedSession(handle.app, {
        sessionId: "a2a-waitwake",
        targetObjectId: "coordinator",
        initialMessage:
          "请你去问 helper：OOC 项目的吉祥物叫什么名字？拿到答案后告诉我。",
      });

      // **关键**：不等 initial job（它在 coordinator `say(wait)` 进 waiting 时就返回了，
      // 见 MEMORY waitForSuperFlow 同理）。必须等 coordinator THREAD 走到终态——这段才
      // 覆盖 helper 在独立 job 里回复 + coordinator 从 waiting 唤醒。轮询时顺手记录是否
      // 观察到过 waiting（caller 卡死的直接前置状态）。
      const poll = await pollThreadToTerminal(
        handle.baseDir,
        seeded.sessionId,
        seeded.targetObjectId,
        seeded.targetThreadId,
        300_000,
      );

      const coordinatorThread = await readCalleeThread(
        handle.baseDir,
        seeded.sessionId,
        seeded.targetObjectId,
        seeded.targetThreadId,
      );

      // helper 的 callee thread：扫 helper objects 目录下被 coordinator 创建的 thread
      const helperThreadId = await findFirstThreadId(
        handle.baseDir,
        seeded.sessionId,
        "helper",
      );
      const helperThread = helperThreadId
        ? await readCalleeThread(handle.baseDir, seeded.sessionId, "helper", helperThreadId)
        : undefined;

      // coordinator 发给 helper 的消息（coordinator.outbox 中 toObject/peer=helper）
      const coordinatorToHelper = (coordinatorThread?.outbox ?? []).filter(
        (m) => m.toThreadId === helperThreadId || m.source === "talk",
      );
      const helperInboxFromCoordinator = (helperThread?.inbox ?? []).filter(
        (m) => m.fromObjectId === "coordinator" || m.source === "talk",
      );
      const helperReplied = repliesFromHelper(coordinatorThread);
      // waiting 观察：轮询期间见到过 waiting（直接证据），或 thread.events 留痕（辅证）
      const coordinatorWaited = poll.sawWaiting || sawWaiting(coordinatorThread);
      const coordinatorWoke =
        coordinatorThread?.status === "done" || coordinatorThread?.status === "failed";
      const coordinatorEndedClean = coordinatorThread?.status === "done";

      const result = scoreScenario({
        scenario: "agent↔agent wait/wake",
        bad: [
          {
            name: "coordinator 没向 helper 发出任何消息",
            check: () => coordinatorToHelper.length === 0,
          },
          {
            name: "helper 没收到 coordinator 的消息（helper thread 缺失或 inbox 空）",
            check: () => !helperThread || helperInboxFromCoordinator.length === 0,
          },
          {
            name: "coordinator 卡死 waiting（轮询超时仍未离开 waiting）",
            check: () => poll.finalStatus === "waiting" || poll.timedOut,
          },
        ],
        good: [
          { name: "coordinator 进入过 waiting（say wait=true）", check: () => coordinatorWaited },
          { name: "helper 回信回到 coordinator.inbox", check: () => helperReplied > 0 },
          { name: "coordinator 从 waiting 唤醒并 end（status=done）", check: () => coordinatorEndedClean },
          {
            name: "helper 回复含吉祥物名 Stone",
            check: () =>
              (helperThread?.outbox ?? []).some((m) => /Stone/i.test(m.content)),
          },
        ],
      });

      logScore(result, {
        pollFinalStatus: poll.finalStatus,
        pollSawWaiting: poll.sawWaiting,
        pollTimedOut: poll.timedOut,
        coordinatorStatus: coordinatorThread?.status,
        helperStatus: helperThread?.status,
        coordinatorWaited,
        coordinatorWoke,
        helperReplied,
        coordinatorToHelper: coordinatorToHelper.length,
        helperInboxFromCoordinator: helperInboxFromCoordinator.length,
        coordinatorCommands: listOpenedCommands(coordinatorThread).slice(0, 40),
        helperCommands: listOpenedCommands(helperThread).slice(0, 40),
      });

      // 硬断言：关键路径不能 Bad（caller 卡死 / 消息没送达就是 talk 塌缩破坏的信号）
      expect(result.tier).not.toBe("Bad");
      // 唤醒是本测试的核心断言：caller 必须从 waiting 转出到终态（否则塌缩破坏了 cross-object wake）
      expect(coordinatorWoke).toBe(true);
    },
    600_000,
  );
});

/**
 * 轮询 thread 直到终态（done/failed）；途中记录是否见到过 waiting。
 *
 * 为什么不复用 waitForJob：caller 的 initial job 在它 `say(wait)` 进 waiting 时就返回，
 * 不覆盖「callee 回复 + caller 唤醒」这段——那发生在独立 job 里。本测试关心的恰是这段，
 * 所以直接观察 thread.status 的终态迁移。
 */
async function pollThreadToTerminal(
  baseDir: string,
  sessionId: string,
  objectId: string,
  threadId: string,
  timeoutMs: number,
): Promise<{ finalStatus: string; sawWaiting: boolean; timedOut: boolean }> {
  const deadline = Date.now() + timeoutMs;
  let sawWaitingFlag = false;
  let last = "missing";
  while (Date.now() < deadline) {
    const t = await readCalleeThread(baseDir, sessionId, objectId, threadId);
    last = t?.status ?? "missing";
    if (last === "waiting") sawWaitingFlag = true;
    if (last === "done" || last === "failed") {
      return { finalStatus: last, sawWaiting: sawWaitingFlag, timedOut: false };
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return { finalStatus: last, sawWaiting: sawWaitingFlag, timedOut: true };
}

/** 列出某 session 下某 object 的第一个 thread id（helper 被 coordinator 创建的 callee）。 */
async function findFirstThreadId(
  baseDir: string,
  sessionId: string,
  objectId: string,
): Promise<string | undefined> {
  const { readdir } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const dir = join(baseDir, "flows", sessionId, "objects", objectId, "threads");
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    const ids = entries.filter((e) => e.isDirectory()).map((e) => e.name);
    return ids.sort().at(0);
  } catch {
    return undefined;
  }
}
