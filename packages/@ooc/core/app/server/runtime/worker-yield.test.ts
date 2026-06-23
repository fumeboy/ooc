import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJobManager } from "./job-manager";
import { runJob, processQueuedJobs, type RuntimeJobResult } from "./worker";
import type { ServerConfig } from "../bootstrap/config";
import { nestedObjectPath } from "@ooc/core/persistable";
import { readThread } from "@ooc/builtins/agent/thread/persistable/thread-json";
import type { ThreadContext } from "@ooc/builtins/agent/thread/types.js";
import type { RuntimeJob } from "./types";

/**
 * scheduler yield 自唤醒。
 *
 * 验证 runJob 单次跑满 workerMaxTicks 自然返回，且 thread.status 仍为 running 时：
 *   1. thread.events 末尾追加一条 scheduler_yielded（reason=max_ticks）留痕
 *   2. thread.status 仍为 running（runJob 不改 thread 终态）
 *   3. runJob 本身**不**入队续跑——续跑由 processQueuedJobs 在当前 job 标 done 后做，
 *      避免在当前 job 仍 running 时 createRunThreadJob 被 dedupe 自吞（thread 冻结根因）。
 *      续跑路径由下方 "processQueuedJobs scheduler yield 续跑" describe 覆盖（真实 claim 路径）。
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
    const threadDir = join(baseDir, "flows", sessionId, "objects", ...nestedObjectPath(objectId), "threads", threadId);
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

    // 3) runJob 本身**不再**自行入队续跑（续跑改由 processQueuedJobs 在标 done 后做）。
    //    若 runJob 此刻入队，当前 job 仍 running → createRunThreadJob dedupe 命中自己 →
    //    续跑被吞 → thread 冻结。这里确认 runJob 不 requeue。
    expect(jobManager.listJobs()).toHaveLength(0);
  });

  test("跑满 maxTicks 但 thread 已 done → 不写 scheduler_yielded 不再入队", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "ooc-yield-"));
    const sessionId = "s1";
    const objectId = "agent_b";
    const threadId = "root";

    const threadDir = join(baseDir, "flows", sessionId, "objects", ...nestedObjectPath(objectId), "threads", threadId);
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

/**
 * scheduler yield 续跑（修复 max_ticks 冻结 hang）。
 *
 * 续跑入队的职责从 runJob 移到 processQueuedJobs（标当前 job done 之后）。这里用**真实
 * claim 路径**（createRunThreadJob 注册 → processQueuedJobs 经 tryClaimQueuedJob 翻 running）
 * 验证续跑——这正是旧测试用"未注册 job"掩盖、真实 worker 却冻结的场景：
 * 当前 job 标 done 后再 createRunThreadJob，dedupe(findRunning queued|running) 不再命中自己。
 */
describe("processQueuedJobs scheduler yield 续跑", () => {
  test("claimed job 跑完 thread 仍 running → 标 done + 续跑入队（防 dedupe 自吞）", async () => {
    const jobManager = createJobManager();
    const sessionId = "s1", objectId = "agent_c", threadId = "root";
    // 真实路径：createRunThreadJob 注册 initial（queued）→ processQueuedJobs claim 成 running。
    const initial = jobManager.createRunThreadJob({ sessionId, objectId, threadId });

    // fake runner 模拟 runJob 跑满 maxTicks 返回 running（不依赖真 LLM / fs）。
    const fakeRunner = async (): Promise<RuntimeJobResult> => ({ threadStatus: "running" });
    await processQueuedJobs({ jobManager } as unknown as ServerConfig, fakeRunner);

    // initial job 被标 done。
    expect(jobManager.getJob(initial.jobId)?.status).toBe("done");
    // 关键断言：续跑 job 入队成功。旧 bug 下 createRunThreadJob 在当前 job 仍 running 时被
    // dedupe 自吞 → 这里会拿到 0 个 → 测试失败暴露 hang 根因。
    const queued = jobManager
      .listJobs()
      .filter((j) => j.status === "queued" && j.threadId === threadId);
    expect(queued).toHaveLength(1);
    expect(queued[0].jobId).not.toBe(initial.jobId);
    expect(queued[0].kind).toBe("run-thread");
  });

  test("thread done → 不续跑入队", async () => {
    const jobManager = createJobManager();
    const initial = jobManager.createRunThreadJob({
      sessionId: "s1",
      objectId: "agent_d",
      threadId: "root",
    });
    const fakeRunner = async (): Promise<RuntimeJobResult> => ({ threadStatus: "done" });
    await processQueuedJobs({ jobManager } as unknown as ServerConfig, fakeRunner);

    expect(jobManager.getJob(initial.jobId)?.status).toBe("done");
    expect(jobManager.listJobs().filter((j) => j.status === "queued")).toHaveLength(0);
  });
});
