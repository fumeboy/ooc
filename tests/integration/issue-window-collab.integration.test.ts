/**
 * U12 集成测试 — Issue 协作 e2e(LLM-driven)
 *
 * 用户故事:
 *   alice 创建一个 Issue 让 bob 评估;bob 持有同 Issue 的 IssueWindow,在收到
 *   @bob 通知后追加 comment 回复。双方都正确完成自己的工作 → done。
 *
 * 评分(per meta/engineering/how_to_test/strategy.md §2):
 *
 * | 档 | 条件 |
 * |---|---|
 * | Good | Issue 文件被创建;comments[] >= 2 条;至少一条来自 alice 另一条来自 bob;
 *         bob 的 comment 引用了 alice 的内容(语义级,通过文本匹配题目关键词判断);
 *         alice/bob thread 都 done |
 * | OK   | Issue 创建 + comments >= 1 但 bob 未参与, 或 bob 参与但内容浅 |
 * | Bad  | Issue 未创建 / 任一 thread 卡 running/waiting / @ mention 完全没起作用 |
 *
 * 注意:Worker 调度跨 thread 较复杂;本测试简化为手动驱动两 thread 的 runScheduler,
 * 中间手动调 syncIssueWindowCommentsForTest 模拟 worker tick 把 alice 写的 comment
 * 注入 bob inbox。生产环境由 worker 自动完成。
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { runScheduler } from "../../src/thinkable/scheduler";
import {
  createFlowObject,
  createStoneObject,
  issuesService,
  writeReadme,
} from "../../src/persistable";
import { hasLlmEnv, llm, setupTempFlow } from "./_fixture";
import { initContextWindows } from "../../src/executable/windows";
import { syncIssueWindowCommentsForTest } from "../../src/app/server/runtime/worker";
import type { ThreadContext } from "../../src/thinkable/context";
import type { IssueWindow } from "../../src/executable/windows/types";

// trigger windows registry (issue.ts registerWindowType side-effect)
import "../../src/executable/windows";

const BOB_README = `
我是 bob,一名经验丰富的代码审阅者。我关注:
1. 改动是否解决真问题(而非追求形式干净)
2. 边界条件:空输入 / 并发 / 失败回退是否考虑
3. 命名是否准确表达意图
`.trim();

const ALICE_PROMPT = [
  "你是 alice。请按以下步骤完成:",
  "",
  "1. 用 root.create_issue 创建一个 Issue,title=\"重命名提案: processData → handleEvent\",",
  "   description=\"想把 src/utils/processData.ts 改名为 handleEvent.ts,因为目前函数",
  "   实际只处理事件分发,不做数据处理。请评估命名准确性。\"",
  "2. 用 issue_window.comment 发起讨论,显式 mention bob,",
  "   text 大意是: \"@bob 我想把 processData 改名为 handleEvent,你觉得呢?\",",
  "   args 里再传 mentions=[\"bob\"]",
  "3. wait(on=<issue_window_id>) 等 bob 回复",
  "4. 看完 bob 的回复后 end thread,summary 含你的最终决定",
].join("\n");

const BOB_PROMPT = [
  "你是 bob。你被分配处理一个 Issue:",
  "",
  "1. 用 open_issue 订阅 Issue#1(已存在)",
  "2. 看完 Issue description 后,用 issue_window.comment 给出你的评估",
  "   text 至少 30 字,基于'重命名提案'/'processData'/'handleEvent' 这些关键词",
  "   表达你的看法(支持 / 反对都行,但要给出理由)",
  "3. end thread",
].join("\n");

describe.skipIf(!hasLlmEnv)("integration: Issue collaboration (LLM-driven)", () => {
  let tempRoot: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ tempRoot, cleanup } = await setupTempFlow());
  });

  afterEach(async () => {
    await cleanup();
  });

  test("alice creates Issue, bob comments, both reach done", async () => {
    // 1) stones + bob readme(让 alice 在 talk relation 时能看到)
    await createStoneObject({ baseDir: tempRoot, objectId: "alice" });
    await createStoneObject({ baseDir: tempRoot, objectId: "bob" });
    await writeReadme({ baseDir: tempRoot, objectId: "bob" }, BOB_README);

    // 2) flow objects + threads
    const aliceFlow = await createFlowObject({ baseDir: tempRoot, sessionId: "s", objectId: "alice" });
    const bobFlow = await createFlowObject({ baseDir: tempRoot, sessionId: "s", objectId: "bob" });

    const aliceMsgId = `msg_init_${Math.random().toString(36).slice(2, 10)}`;
    const aliceThread: ThreadContext = {
      id: "root",
      status: "running",
      inbox: [{
        id: aliceMsgId,
        fromThreadId: "user",
        toThreadId: "root",
        content: ALICE_PROMPT,
        createdAt: Date.now(),
        source: "user",
      }],
      events: [{ category: "context_change", kind: "inbox_message_arrived", msgId: aliceMsgId }],
      contextWindows: [],
      persistence: { ...aliceFlow, threadId: "root" },
    };
    initContextWindows(aliceThread, { initialTaskTitle: "create issue + invite bob" });

    // 3) 跑 alice → 应该 create_issue + comment + wait
    await runScheduler(aliceThread, llm(), { maxTicks: 20 });

    // 验证:Issue 已创建
    const issues = await issuesService.listIssues({ baseDir: tempRoot, sessionId: "s" });
    expect(issues.length).toBeGreaterThan(0); // === 'Bad' floor 验证

    if (issues.length === 0) {
      throw new Error("Bad: alice 没有创建 Issue");
    }
    const issueId = issues[0]!.id;

    // 4) bob thread:open_issue 一开始就能在 derive 里看到 alice 的 comment(若有),
    //    再 comment + end。先建 bob root thread
    const bobMsgId = `msg_init_${Math.random().toString(36).slice(2, 10)}`;
    const bobThread: ThreadContext = {
      id: "root",
      status: "running",
      inbox: [{
        id: bobMsgId,
        fromThreadId: "user",
        toThreadId: "root",
        content: BOB_PROMPT.replace("Issue#1", `Issue#${issueId}`),
        createdAt: Date.now(),
        source: "user",
      }],
      events: [{ category: "context_change", kind: "inbox_message_arrived", msgId: bobMsgId }],
      contextWindows: [],
      persistence: { ...bobFlow, threadId: "root" },
    };
    initContextWindows(bobThread, { initialTaskTitle: "review issue" });

    await runScheduler(bobThread, llm(), { maxTicks: 20 });

    // 5) sync bob → alice 的 thread(让 alice 看到 bob 的新 comment 进 inbox)
    await syncIssueWindowCommentsForTest(aliceThread, tempRoot);

    // 6) alice 第二次 runScheduler — 看 bob 回复后 end
    await runScheduler(aliceThread, llm(), { maxTicks: 20 });

    // ────────────────────────────────────────
    // 评分
    // ────────────────────────────────────────
    const finalIssue = await issuesService.getIssue({
      baseDir: tempRoot,
      sessionId: "s",
      issueId,
    });
    const comments = finalIssue?.comments ?? [];
    const fromAlice = comments.filter((c) => c.authorObjectId === "alice");
    const fromBob = comments.filter((c) => c.authorObjectId === "bob");

    const bobContent = fromBob.map((c) => c.text).join(" ").toLowerCase();
    const bobReferencesAlice =
      bobContent.includes("rename") ||
      bobContent.includes("重命名") ||
      bobContent.includes("processdata") ||
      bobContent.includes("handleevent") ||
      bobContent.includes("命名");

    const aliceDone = aliceThread.status === "done";
    const bobDone = bobThread.status === "done";

    const grade =
      finalIssue &&
      fromAlice.length >= 1 &&
      fromBob.length >= 1 &&
      bobReferencesAlice &&
      aliceDone &&
      bobDone
        ? "Good"
        : finalIssue && fromAlice.length + fromBob.length >= 1
          ? "OK"
          : "Bad";

    console.log(
      `[issue-collab-e2e] grade=${grade} ` +
        `alice_done=${aliceDone} bob_done=${bobDone} ` +
        `comments_alice=${fromAlice.length} comments_bob=${fromBob.length} ` +
        `bob_refs_alice=${bobReferencesAlice}`,
    );

    // 验收门槛:至少 OK
    expect(grade).not.toBe("Bad");
  }, 300_000);
});
