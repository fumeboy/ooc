import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJobManager } from "./job-manager";
import { resumePausedThreadsInSession } from "./resume-orchestration";
import { nestedObjectPath } from "@ooc/core/persistable";
import { readThread } from "@ooc/builtins/agent/thread/persistable/thread-json";
import type { ThreadContext } from "@ooc/core/thinkable/context";

/**
 * Resume 编排回归（修「pause 后 resume 100% 崩溃」）。
 *
 * 旧 bug：编排层在入队 resume-thread job 前先 writeThread(applyResumeTransition) 把
 * paused→running 落盘；job handler(resume.ts) readThread 后断言 canResumeThread(=paused)
 * → 读到 running → 抛 "is not paused" → thread 永久卡 running。
 *
 * 修复：编排层只「发现 paused + 入队」，不预翻转；转换由 handler 做。本测试锚定该契约：
 * resumePausedThreadsInSession 后 thread **仍 paused**（若有人加回预翻转，断言失败）。
 *
 * 此前盲区：thread-transition.test.ts 只测纯函数（canResumeThread/applyResumeTransition），
 * 未测编排层是否预翻转——bug 正是从这条集成缝里溜过。
 */
describe("resume-orchestration: 编排不预翻转 paused→running", () => {
  test("paused thread → 入队 resume-thread job 且 thread 保持 paused", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "ooc-resume-orch-"));
    const sessionId = "s1";
    const objectId = "agent_p";
    const threadId = "root";

    const objectDir = join(baseDir, "flows", sessionId, "objects", ...nestedObjectPath(objectId));
    const threadDir = join(objectDir, "threads", threadId);
    await mkdir(threadDir, { recursive: true });
    // .flow.json marker：scanPausedThreads 仅把「直接含 .flow.json」的目录当 flow object。
    await writeFile(join(objectDir, ".flow.json"), JSON.stringify({ class: objectId }), "utf8");
    const fixture: ThreadContext = {
      id: threadId,
      status: "paused",
      events: [],
      contextWindows: [],
      persistence: { baseDir, sessionId, objectId, threadId },
    };
    await writeFile(join(threadDir, "thread.json"), JSON.stringify(fixture, null, 2), "utf8");

    const jobManager = createJobManager();
    const resumed = await resumePausedThreadsInSession({ baseDir, jobManager }, sessionId);

    // 1) 入队了一个 resume-thread job
    expect(resumed).toHaveLength(1);
    expect(resumed[0].resumedThreadId).toBe(`${objectId}/${threadId}`);
    const jobs = jobManager.listJobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0].kind).toBe("resume-thread");
    expect(jobs[0].status).toBe("queued");

    // 2) 关键：thread **仍 paused**（编排不预翻转）。handler 接手后才转 running——
    //    若回归预翻转成 running，handler 的 canResumeThread 断言会抛 "is not paused"。
    const reloaded = await readThread({ baseDir, sessionId, objectId }, threadId);
    expect(reloaded?.status).toBe("paused");
  });

  test("非 paused thread（running）→ 不入队（canResumeThread 守门）", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "ooc-resume-orch-"));
    const sessionId = "s1";
    const objectId = "agent_r";
    const threadId = "root";

    const objectDir = join(baseDir, "flows", sessionId, "objects", ...nestedObjectPath(objectId));
    const threadDir = join(objectDir, "threads", threadId);
    await mkdir(threadDir, { recursive: true });
    // .flow.json marker：scanPausedThreads 仅把「直接含 .flow.json」的目录当 flow object。
    await writeFile(join(objectDir, ".flow.json"), JSON.stringify({ class: objectId }), "utf8");
    // status=running：scanPausedThreads 不会扫到它（只扫 paused），故不入队。
    const fixture: ThreadContext = {
      id: threadId,
      status: "running",
      events: [],
      contextWindows: [],
      persistence: { baseDir, sessionId, objectId, threadId },
    };
    await writeFile(join(threadDir, "thread.json"), JSON.stringify(fixture, null, 2), "utf8");

    const jobManager = createJobManager();
    const resumed = await resumePausedThreadsInSession({ baseDir, jobManager }, sessionId);

    expect(resumed).toHaveLength(0);
    expect(jobManager.listJobs()).toHaveLength(0);
  });
});
