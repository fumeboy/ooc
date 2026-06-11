/**
 * S5 — backend-reflectable-sediment
 *
 * 类别：reflectable 自我反思沉淀（super flow）。
 * 现有 backend e2e（S1-S4）覆盖 thinkable / executable / collaborable；reflectable
 * 维度（super flow 自我反思 + memory 沉淀 + 元编程改 self.md）此前无 e2e 覆盖。
 *
 * 本场景走真实用户路径触发 super flow，借真链路实证两条刚落地的修复：
 *   1. memory 落 pools/<self>/knowledge/memory/<slug>.md 且含合法 frontmatter
 *      （reflectable.memory_layout 的 sediment write contract；pool 直写即时沉淀，无 PR）
 *   2. （若 super flow 沉淀 self.md）self.md 经 reflectable feat-branch PR 进 git
 *      （super flow new_feat_branch → 直接编辑 feat worktree → evolve_self commit + PR；resolve merge 后落 main）。
 *      地基不变量：session worktree 永不合入 main——沉淀走独立 feat 分支。
 *
 * 与 end-reflection-reminder.e2e.test.ts 的区别：那个测「业务 thread 调 end 时
 * 注入反思提醒 knowledge」（纯函数 buildInputItems，不真跑反思）；本测真起 worker +
 * 真 LLM，验反思的**实际执行落盘**。
 *
 * 观察孔:
 *   A（user story）: 反思请求被处理，assistant 回到 user（user.root inbox 有回复）。
 *   B（机制）:
 *     ① super session 反思线程被创建（flows/super/<self>/threads/...）
 *     ② memory 文件落 pools/<self>/knowledge/memory/<slug>.md 含合法 frontmatter
 *     ③ 若 super flow 改 self.md → 在 stones bare repo 有 commit
 */

import { afterEach, beforeAll, describe, expect, it } from "bun:test";
import {
  assistantRepliesToUser,
  continueThread,
  fileExists,
  hasLlmEnv,
  hasValidFrontmatter,
  listMemoryFiles,
  listOpenedCommands,
  listSuperThreadIds,
  loadRealEnv,
  logScore,
  readCalleeThread,
  readFile,
  readUserRootThread,
  scoreScenario,
  seedSession,
  shouldRunBackendE2E,
  startApp,
  stoneFileCommits,
  waitForJob,
  waitForSuperFlow,
  type AppHandle,
} from "./_fixture";

const SELF_ID = "assistant";

const SEED_SELF = `你是用户的 CodeAgent，遵循 OOC 协议。

工作守则：
- 改代码用 file_window.edit，不要用 shell。
- 需要沉淀长期经验时走 super flow（talk target="super"）。
`;

const SEED_NOTE = `# 项目约定

本项目的所有时间戳统一使用 UTC，禁止使用本地时区。
日志格式为 JSON Lines（每行一个 JSON 对象）。
`;

describe.skipIf(!shouldRunBackendE2E)("[e2e backend] S5 reflectable-sediment", () => {
  let handle: AppHandle | undefined;

  beforeAll(() => {
    loadRealEnv();
  });

  afterEach(() => {
    handle?.cleanup();
    handle = undefined;
  });

  it.skipIf(!hasLlmEnv())(
    "用户让 assistant 把项目约定沉淀为长期记忆 → super flow 写 memory（必要时改 self.md 经 git）",
    async () => {
      handle = await startApp({
        seedFiles: [{ path: "docs/note.md", content: SEED_NOTE }],
        seedStones: [{ objectId: SELF_ID, self: SEED_SELF }],
        // 关键：buildServer 不自动 ensureStoneRepo（那是 startOocServer 的副作用）。
        // 涉及 stone-versioning（super flow 改 self.md 进 git）必须显式 init，
        // 否则 self.md 既读不到（路径在 stones/main/objects/）也无 repo 可 commit。
        initStoneGit: true,
        workerMaxTicks: 60,
      });

      // 轮 1：先做一个小任务（读 docs/note.md 回答），让 assistant 有"刚学到的东西"
      const seeded = await seedSession(handle.app, {
        sessionId: "s5-reflect",
        targetObjectId: SELF_ID,
        initialMessage:
          "读一下 docs/note.md，告诉我这个项目对时间戳和日志格式有什么约定？",
      });
      const job1 = await waitForJob(handle.app, seeded.jobId, { timeoutMs: 240_000 });
      const calleeAfterTurn1 = await readCalleeThread(
        handle.baseDir,
        seeded.sessionId,
        seeded.targetObjectId,
        seeded.targetThreadId,
      );
      const turn1Replies = assistantRepliesToUser(calleeAfterTurn1);

      // 轮 2：明确引导走 super flow 沉淀一条长期记忆（reduce LLM 方差）
      const cont = await continueThread(
        handle.app,
        seeded.sessionId,
        "请通过 super flow 把这条项目约定沉淀为你的一条长期记忆：" +
          "「本项目时间戳统一用 UTC、日志用 JSON Lines」，" +
          "这样以后处理该项目的代码时你能想起来。沉淀完告诉我你记下了什么。",
      );
      const job2 = await waitForJob(handle.app, cont.jobId, { timeoutMs: 300_000 });

      // 关键：业务 job 在 say(target=super, wait=true) 进入 waiting 时即 done，
      // 但反思的落盘副作用在**独立的 super job** 里——必须显式等 super flow 收尾。
      const superFlow = await waitForSuperFlow(handle.baseDir, SELF_ID, { timeoutMs: 300_000 });

      // super 回复后业务 thread 被唤醒继续（向 user 报告沉淀结果），再等它收尾。
      // 给一段额外时间让 worker 的 resume tick 跑完业务 thread 的剩余动作。
      let calleeFinal = await readCalleeThread(
        handle.baseDir,
        seeded.sessionId,
        seeded.targetObjectId,
        seeded.targetThreadId,
      );
      const resumeDeadline = Date.now() + 240_000;
      while (
        Date.now() < resumeDeadline &&
        calleeFinal?.status !== "done"
      ) {
        await new Promise((r) => setTimeout(r, 2_000));
        calleeFinal = await readCalleeThread(
          handle.baseDir,
          seeded.sessionId,
          seeded.targetObjectId,
          seeded.targetThreadId,
        );
      }

      const calleeAfterTurn2 = await readCalleeThread(
        handle.baseDir,
        seeded.sessionId,
        seeded.targetObjectId,
        seeded.targetThreadId,
      );
      const userThread = await readUserRootThread(handle.baseDir, seeded.sessionId);

      // ── 观察孔 B：机制 ──────────────────────────────────────────────
      // ① super 反思线程被创建
      const superThreadIds = listSuperThreadIds(handle.baseDir, SELF_ID);

      // ② memory 文件落 pools/ 带 frontmatter
      const memoryFiles = listMemoryFiles(handle.baseDir, SELF_ID);
      const memoryContents = memoryFiles.map((name) =>
        readFile(handle!.baseDir, `pools/${SELF_ID}/knowledge/memory/${name}`),
      );
      const memoryWithFrontmatter = memoryContents.filter((md) => hasValidFrontmatter(md));
      // memory 是否真提到本次约定关键词（避免"写了个空 memory"假阳性）
      const memoryMentionsConvention = memoryContents.some(
        (md) => /UTC/i.test(md) && /JSON ?Lines?/i.test(md),
      );

      // 误落目录检测：memory 写到了 stones/ 自治区而非 pools/（OK 档信号）
      const memoryMisplacedInStone = fileExists(
        handle.baseDir,
        `stones/main/objects/${SELF_ID}/knowledge/memory`,
      );

      // ③ self.md 是否经 reflectable feat-branch PR 进 git（沉淀实证）
      // bootstrap commit 由 "bootstrap" 署名；createStone 的初始 commit 也署名 SELF_ID
      // （`http:createStone <id>`），故仅凭 author 含 SELF_ID 会把建对象误判为"反思改了
      // self.md"。只认 super flow 经 feat-branch PR 真改 self.md 的 commit，
      // 排除 createStone / bootstrap 这两类非反思初始 commit。
      const selfCommits = stoneFileCommits(handle.baseDir, `objects/${SELF_ID}/self.md`);
      const selfModifiedByAgent = selfCommits.some(
        (line) => line.includes(SELF_ID) && !/createStone|bootstrap/.test(line),
      );

      // ── 观察孔 A：user story ────────────────────────────────────────
      const replies = assistantRepliesToUser(calleeAfterTurn2);
      const turn2ReplyText = replies
        .slice(turn1Replies.length)
        .map((m) => m.content)
        .join("\n");

      const commandsTurn2 = listOpenedCommands(calleeAfterTurn2);
      const openedSuperTalk = commandsTurn2.includes("talk");

      const result = scoreScenario({
        scenario: "S5 reflectable-sediment",
        bad: [
          // super flow 没被触发（既无 super 线程，又没开 talk）
          {
            name: "super flow 未被触发（无 super 线程）",
            check: () => superThreadIds.length === 0,
          },
          // memory 完全没落盘
          { name: "memory 没落盘（pools/ memory 目录为空）", check: () => memoryFiles.length === 0 },
          // assistant 第二轮不回 user
          {
            name: "assistant 第二轮不回 user",
            check: () => replies.length <= turn1Replies.length,
          },
          // super flow 跑挂了（反思线程 failed）
          { name: "super flow 反思线程 failed", check: () => superFlow.status === "failed" },
          // callee 业务 thread 既没 done 也没 waiting（真卡死）
          {
            name: "callee 业务 thread 卡死（非 done/waiting）",
            check: () =>
              calleeAfterTurn2?.status !== "done" && calleeAfterTurn2?.status !== "waiting",
          },
        ],
        good: [
          { name: "轮 1 回复提到 UTC 或 JSON Lines（小任务完成）", check: () => /UTC|JSON ?Lines?/i.test(turn1Replies.map((m) => m.content).join("\n")) },
          { name: "super 反思线程被创建并 done", check: () => superFlow.status === "done" },
          { name: "轮 2 在业务 thread 开了 talk（走 super 入口）", check: () => openedSuperTalk },
          { name: "memory 落对 pools/ 目录（未误落 stones/）", check: () => memoryFiles.length >= 1 && !memoryMisplacedInStone },
          { name: "至少一篇 memory 含合法 frontmatter", check: () => memoryWithFrontmatter.length >= 1 },
          { name: "memory 内容真提到本次约定（UTC + JSON Lines）", check: () => memoryMentionsConvention },
          { name: "assistant 回 user 说明沉淀了什么", check: () => turn2ReplyText.length > 0 && /(沉淀|记下|记录|memory|记忆|UTC)/i.test(turn2ReplyText) },
        ],
      });

      logScore(result, {
        job1Status: job1.status,
        job2Status: job2.status,
        superFlowStatus: superFlow.status,
        superFlowThreadId: superFlow.threadId,
        calleeThreadStatus: calleeAfterTurn2?.status,
        turn1Replies: turn1Replies.length,
        turn2Replies: replies.length - turn1Replies.length,
        superThreadIds,
        memoryFiles,
        memoryWithFrontmatter: memoryWithFrontmatter.length,
        memoryMentionsConvention,
        memoryMisplacedInStone,
        selfMdCommits: selfCommits,
        selfModifiedByAgent,
        commandsTurn2: commandsTurn2.slice(0, 40),
        turn2ReplyPreview: turn2ReplyText.slice(0, 300),
        memoryPreview: memoryContents[0]?.slice(0, 400),
      });

      expect(result.tier).not.toBe("Bad");
    },
    600_000,
  );
});
