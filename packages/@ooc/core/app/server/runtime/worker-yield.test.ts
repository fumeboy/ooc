import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJobManager } from "./job-manager";
import { runJob } from "./worker";
import { readThread, nestedObjectPath } from "@ooc/core/persistable";
import type { ThreadContext } from "@ooc/core/thinkable/context";
import type { RuntimeJob } from "./types";

/**
 * scheduler yield 自唤醒（设计：meta/app.server.doc.ts § worker.scheduler_yielded）。
 *
 * 验证 runJob 单次跑满 workerMaxTicks 自然返回，且 thread.status 仍为 running 时：
 *   1. thread.events 末尾追加一条 scheduler_yielded（reason=max_ticks）
 *   2. jobManager 中针对同一 (sessionId, objectId, threadId) 又出现一个 queued job
 *   3. thread.status 仍为 running（runJob 不改 thread 终态）
 *
 * 用 maxTicks=0 让 runScheduler 不进 tick 循环立即返回，避免依赖 fake LLM client。
 * 这种构造直接验证"thread 还想继续但 runJob 切片"的 yield 行为。
 */
describe("runJob scheduler yield 自唤醒", () => {
  test("跑满 maxTicks 且 thread 仍 running → 写 scheduler_yielded + 自唤醒入队", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "ooc-yield-"));
    const sessionId = "s1";
    const objectId = "agent_a";
    const threadId = "root";

    // 构造一个 status=running 的 thread fixture 落盘。
    // events 中放两条 llm_interaction.call_started，验证 rounds 计数。
    const threadDir = join(baseDir, "flows", sessionId, ...nestedObjectPath(objectId), "threads", threadId);
    await mkdir(threadDir, { recursive: true });
    const fixture: ThreadContext = {
      id: threadId,
      status: "running",
      events: [
        { category: "llm_interaction", kind: "call_started", loopIndex: 0 },
        { category: "llm_interaction", kind: "call_started", loopIndex: 1 },
      ],
      contextWindows: [],
      persistence: { baseDir, sessionId, objectId, threadId },
    };
    await writeFile(
      join(threadDir, "thread.json"),
      JSON.stringify(fixture, null, 2),
      "utf8",
    );

    const jobManager = createJobManager();
    const job: RuntimeJob = {
      sessionId,
      objectId,
      threadId,
      jobId: "job-initial",
      kind: "run-thread",
      status: "running",
    };

    const result = await runJob(job, {
      baseDir,
      workerMaxTicks: 0, // 触发"跑满 0 ticks 立即返回 + thread 仍 running"分支
      jobManager,
    });

    // 1) runJob 返回的 thread 终态仍是 running
    expect(result?.threadStatus).toBe("running");

    // 2) 落盘后的 thread.events 末尾多了一条 scheduler_yielded
    const reloaded = await readThread({ baseDir, sessionId, objectId }, threadId);
    expect(reloaded).toBeDefined();
    const last = reloaded!.events[reloaded!.events.length - 1];
    expect(last.category).toBe("context_change");
    expect(last.kind).toBe("scheduler_yielded");
    expect((last as { reason?: string }).reason).toBe("max_ticks");
    expect((last as { rounds?: number }).rounds).toBe(2);

    // 3) jobManager 队列里有一个新的 queued job 指向同一 thread
    const queued = jobManager.listJobs().filter((j) => j.status === "queued");
    expect(queued).toHaveLength(1);
    expect(queued[0].sessionId).toBe(sessionId);
    expect(queued[0].objectId).toBe(objectId);
    expect(queued[0].threadId).toBe(threadId);
    expect(queued[0].kind).toBe("run-thread");
    // 该 job 不是原始 job（原始 job 没注册到 jobManager 中，只是直接传给 runJob）
    expect(queued[0].jobId).not.toBe(job.jobId);
  });

  test("跑满 maxTicks 但 thread 已 done → 不写 scheduler_yielded 不再入队", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "ooc-yield-"));
    const sessionId = "s1";
    const objectId = "agent_b";
    const threadId = "root";

    const threadDir = join(baseDir, "flows", sessionId, ...nestedObjectPath(objectId), "threads", threadId);
    await mkdir(threadDir, { recursive: true });
    const fixture: ThreadContext = {
      id: threadId,
      status: "done",
      events: [],
      contextWindows: [],
      persistence: { baseDir, sessionId, objectId, threadId },
    };
    await writeFile(
      join(threadDir, "thread.json"),
      JSON.stringify(fixture, null, 2),
      "utf8",
    );

    const jobManager = createJobManager();
    const job: RuntimeJob = {
      sessionId,
      objectId,
      threadId,
      jobId: "job-initial",
      kind: "run-thread",
      status: "running",
    };

    const result = await runJob(job, {
      baseDir,
      workerMaxTicks: 0,
      jobManager,
    });

    expect(result?.threadStatus).toBe("done");

    const reloaded = await readThread({ baseDir, sessionId, objectId }, threadId);
    // events 不应被追加
    expect(reloaded!.events).toHaveLength(0);
    // 不应有任何新 queued job
    expect(jobManager.listJobs()).toHaveLength(0);
  });
});
