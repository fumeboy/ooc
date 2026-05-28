/**
 * S6 — backend-programmable-self-command
 *
 * 类别：programmable 元编程闭环（Object 给自己写一条自定义命令 → 随后调用它）。
 * 现有 backend e2e（S1-S5）覆盖 thinkable / executable / collaborable / reflectable；
 * programmable 维度（Object 持有并演化自身 server 方法库 / 自定义命令表）此前无 e2e 覆盖。
 *
 * 本场景走真实用户路径验证 OOC「元编程」最核心的体验：
 *   轮 1：user 让 assistant 把一个高频小动作封装成一条自定义命令 →
 *         assistant 写 stones/<self>/server/index.ts（export const window，含 commands.<name>）。
 *   轮 2：user 让 assistant 调用刚写的那条命令 →
 *         assistant 走 exec(window_id="custom:<self>", command=<name>, args)，命令真执行返回结果。
 *
 * 分两轮是因为单轮内引导真 LLM 既写又调不稳定（programmable 是 OOC 最难引导的维度之一）。
 *
 * Design spec:
 *   - meta/object.doc.ts:programmable（object_window_definition / loader 热更 /
 *     custom_window_invocation / window_evolution / program_self_injection）
 *   - meta/engineering.testing.doc.ts（Good/OK/Bad + A/B 两观察孔）
 *
 * 观察孔:
 *   A（user story）: assistant 完成「定义命令 + 调用命令」并回 user 报告调用结果。
 *   B（机制）:
 *     ① stones/<self>/server/index.ts 落盘且经 stone-versioning 进 git（stoneFileCommits 验）
 *     ② loader 能加载该 ObjectWindowDefinition（第二轮调用不报 loader/TS 加载错误）
 *     ③ 第二轮 exec(window_id="custom:<self>", command=<新命令>) 真执行、结果进 thread events
 *
 * 关键观察：loader 热加载是否在同一 server 进程内生效——LLM 轮 1 写完 server/index.ts，
 * 轮 2（同一 worker 进程）能否直接调到新命令，无需重启。
 */

import { afterEach, beforeAll, describe, expect, it } from "bun:test";
import {
  assistantRepliesToUser,
  continueThread,
  customWindowInvocations,
  functionOutputFor,
  hasLlmEnv,
  listOpenedCommands,
  loadRealEnv,
  logScore,
  readCalleeThread,
  readUserRootThread,
  scoreScenario,
  seedSession,
  shouldRunBackendE2E,
  startApp,
  stoneFileCommits,
  waitForJob,
  type AppHandle,
} from "./_fixture";

const SELF_ID = "assistant";

const SEED_SELF = `你是用户的 CodeAgent，遵循 OOC 协议。

你具备 programmable 能力：你在自己的 stone 里有一份 \`stones/${SELF_ID}/server/index.ts\`，
可以 \`export const window: ObjectWindowDefinition\` 给自己注册自定义命令（commands 字典）。
写好后，你可以通过 \`exec(window_id="custom:${SELF_ID}", command="<名字>", args={...})\` 直接调用它们。

工作守则：
- 写自定义命令时用 write_file 写 \`stones/${SELF_ID}/server/index.ts\`。
- 每条命令是一个 CommandTableEntry：必须有 \`exec: async (ctx) => { ... }\`，
  返回值（字符串）会进入调用结果。可选 paths / match / knowledge。
- ctx.args 是调用时传入的 args。
`;

describe.skipIf(!shouldRunBackendE2E)("[e2e backend] S6 programmable-self-command", () => {
  let handle: AppHandle | undefined;

  beforeAll(() => {
    loadRealEnv();
  });

  afterEach(() => {
    handle?.cleanup();
    handle = undefined;
  });

  it.skipIf(!hasLlmEnv())(
    "用户让 assistant 给自己写一条 add 命令 → 第二轮调用它，验证元编程闭环",
    async () => {
      handle = await startApp({
        seedStones: [{ objectId: SELF_ID, self: SEED_SELF }],
        // 关键：写 stones/<self>/server/index.ts 走 stone-versioning，需 bare repo（见 _fixture S5 经验）。
        bootstrapStoneRepo: true,
        workerMaxTicks: 60,
      });

      // ── 轮 1：引导 assistant 给自己写一条 add 命令 ────────────────────────
      const seeded = await seedSession(handle.app, {
        sessionId: "s6-programmable",
        targetObjectId: SELF_ID,
        initialMessage:
          `请给你自己写一条自定义命令，名字叫 \`add\`，作用是把传入的两个数字相加并返回结果。` +
          `具体做法：用 write_file 写 \`stones/${SELF_ID}/server/index.ts\`，` +
          `\`export const window: ObjectWindowDefinition = { commands: { add: { exec: async (ctx) => { ` +
          `const { a, b } = ctx.args; return String(Number(a) + Number(b)); } } } }\`。` +
          `写完告诉我命令已就绪。这一轮不要调用它。`,
      });
      const job1 = await waitForJob(handle.app, seeded.jobId, { timeoutMs: 300_000 });

      const calleeAfterTurn1 = await readCalleeThread(
        handle.baseDir,
        seeded.sessionId,
        seeded.targetObjectId,
        seeded.targetThreadId,
      );
      const turn1Replies = assistantRepliesToUser(calleeAfterTurn1);
      const turn1Commands = listOpenedCommands(calleeAfterTurn1);

      // ① server/index.ts 是否经 stone-versioning 进 git
      const serverCommits = stoneFileCommits(
        handle.baseDir,
        `objects/${SELF_ID}/server/index.ts`,
      );

      // ── 轮 2：引导 assistant 调用刚写的 add 命令 ──────────────────────────
      const cont = await continueThread(
        handle.app,
        seeded.sessionId,
        `现在调用你刚写的 \`add\` 命令：` +
          `\`exec(window_id="custom:${SELF_ID}", command="add", args={ a: 2, b: 3 })\`，` +
          `把它返回的结果告诉我。`,
      );
      const job2 = await waitForJob(handle.app, cont.jobId, { timeoutMs: 300_000 });

      // 给 worker 一段时间把第二轮 thread 跑到 done（调用 + 回 user）。
      let calleeFinal = await readCalleeThread(
        handle.baseDir,
        seeded.sessionId,
        seeded.targetObjectId,
        seeded.targetThreadId,
      );
      const resumeDeadline = Date.now() + 180_000;
      while (Date.now() < resumeDeadline && calleeFinal?.status !== "done") {
        await new Promise((r) => setTimeout(r, 2_000));
        calleeFinal = await readCalleeThread(
          handle.baseDir,
          seeded.sessionId,
          seeded.targetObjectId,
          seeded.targetThreadId,
        );
      }

      const calleeAfterTurn2 = calleeFinal;
      const userThread = await readUserRootThread(handle.baseDir, seeded.sessionId);

      // ── 观察孔 B：机制 ──────────────────────────────────────────────
      // ③ 第二轮 custom window 调用记录 + 对应输出
      const invocations = customWindowInvocations(calleeAfterTurn2, SELF_ID);
      const addInvocations = invocations.filter((i) => i.command === "add");
      const addOutputs = addInvocations
        .map((i) => functionOutputFor(calleeAfterTurn2, i.callId))
        .filter((o) => o.output !== undefined);
      // 命令真执行且返回正确结果（2 + 3 = 5）。容忍输出里夹带其它文字。
      const addReturnedFive = addOutputs.some(
        (o) => o.ok !== false && /(^|[^0-9])5([^0-9]|$)/.test(o.output ?? ""),
      );
      // loader 加载失败 / TS 解析错误的迹象（custom 命令调用回了报错而非结果）。
      const loaderErrored = addOutputs.some(
        (o) =>
          o.ok === false ||
          /llm_methods|SyntaxError|Cannot find|未注册|加载失败|无法|not a function|undefined is not/i.test(
            o.output ?? "",
          ),
      );

      // ── 观察孔 A：user story ────────────────────────────────────────
      const replies = assistantRepliesToUser(calleeAfterTurn2);
      const turn2ReplyText = replies
        .slice(turn1Replies.length)
        .map((m) => m.content)
        .join("\n");
      const turn2ReportsFive = /(^|[^0-9])5([^0-9]|$)/.test(turn2ReplyText);

      const commandsTurn2 = listOpenedCommands(calleeAfterTurn2);

      const result = scoreScenario({
        scenario: "S6 programmable-self-command",
        bad: [
          // server/index.ts 完全没进 git（既没写或没经 versioning）
          {
            name: "server/index.ts 未进 git（未写或绕过 versioning）",
            check: () => serverCommits.length === 0,
          },
          // 第二轮根本没调到 custom:<self> 的 add 命令
          {
            name: "第二轮未发起 custom:add 调用",
            check: () => addInvocations.length === 0,
          },
          // 调用了但 loader/TS 加载失败 / 命令调不到（返回报错）
          {
            name: "custom 命令调用报错（loader 加载失败 / TS 错 / 命令未注册）",
            check: () => loaderErrored,
          },
          // assistant 第二轮不回 user
          {
            name: "assistant 第二轮不回 user",
            check: () => replies.length <= turn1Replies.length,
          },
          // callee 业务 thread 卡死
          {
            name: "callee 业务 thread 卡死（非 done/waiting）",
            check: () =>
              calleeAfterTurn2?.status !== "done" && calleeAfterTurn2?.status !== "waiting",
          },
        ],
        good: [
          {
            name: "轮 1 用 write_file 写 server/index.ts",
            check: () => turn1Commands.includes("write_file"),
          },
          {
            name: "server/index.ts 经 stone-versioning 进 git",
            check: () => serverCommits.length >= 1,
          },
          {
            name: "轮 2 发起了 custom:add 调用",
            check: () => addInvocations.length >= 1,
          },
          {
            name: "add 命令真执行并返回正确结果（5）",
            check: () => addReturnedFive,
          },
          {
            name: "assistant 回 user 报告结果含 5",
            check: () => turn2ReportsFive,
          },
        ],
      });

      logScore(result, {
        job1Status: job1.status,
        job2Status: job2.status,
        calleeThreadStatus: calleeAfterTurn2?.status,
        turn1Replies: turn1Replies.length,
        turn2Replies: replies.length - turn1Replies.length,
        turn1Commands: turn1Commands.slice(0, 40),
        commandsTurn2: commandsTurn2.slice(0, 40),
        serverMdCommits: serverCommits,
        addInvocations: addInvocations.length,
        addOutputs: addOutputs.map((o) => ({ ok: o.ok, output: (o.output ?? "").slice(0, 200) })),
        addReturnedFive,
        loaderErrored,
        turn2ReportsFive,
        userThreadStatus: userThread?.status,
        turn2ReplyPreview: turn2ReplyText.slice(0, 400),
      });

      expect(result.tier).not.toBe("Bad");
    },
    600_000,
  );
});
