import { createLlmClient } from "@src/thinkable/llm/client";
import { readThread, writeThread } from "@src/persistable";
import { runScheduler } from "@src/thinkable/scheduler";
import type { ServerConfig } from "../bootstrap/config";
import type { RuntimeJob } from "./types";
import type { ThreadContext } from "@src/thinkable/context";
import type { TalkWindow } from "@src/executable/windows/types";
import { SUPER_ALIAS_TARGET, SUPER_SESSION_ID } from "@src/executable/windows/super-constants";
import { resumePausedThread } from "./resume";
import { scanRunningThreads } from "./thread-query";

export type RuntimeJobRunner = (job: RuntimeJob, config: ServerConfig) => Promise<void>;

/**
 * 约定值：user 是 web session 中的特殊 flow object，由控制面（人类）驱动；
 * worker 跳过它，让任何针对 user object 的 thread 都不被 LLM 调度。
 *
 * collaborable § cross-object talk（spec 2026-05-15）。
 */
const USER_OBJECT_ID = "user";

export async function runJob(
  job: RuntimeJob,
  config: Pick<ServerConfig, "baseDir" | "workerMaxTicks">
): Promise<void> {
  if (job.objectId === USER_OBJECT_ID) {
    // user object 是被动对象——所有思考由 web 用户在 UI 上完成，worker 不调度
    return;
  }

  if (job.kind === "resume-thread") {
    await resumePausedThread({
      baseDir: config.baseDir,
      sessionId: job.sessionId,
      objectId: job.objectId,
      threadId: job.threadId,
    });
    return;
  }

  const rootThread = await readThread(
    {
      baseDir: config.baseDir,
      sessionId: job.sessionId,
      objectId: job.objectId,
    },
    job.threadId
  );
  if (!rootThread) {
    throw new Error(`thread not found: ${job.threadId}`);
  }
  // 跑 scheduler 前先把"caller waiting on 已结束的 cross-object callee" 唤醒
  // (scheduler.emitChildEndNotifications 只覆盖 in-tree childThreads,无法跨 object)
  await syncCrossObjectCalleeEnds(rootThread, config.baseDir, job.sessionId);
  await runScheduler(rootThread, createLlmClient(), { maxTicks: config.workerMaxTicks ?? 15 });
}

export async function processQueuedJobs(
  config: ServerConfig,
  runner: RuntimeJobRunner = runJob
): Promise<void> {
  // 入口先做一次"全 session 兜底扫描":对每个有 running thread 但当前没在 jobManager
  // 队列里的 (session,object,thread) 入队 run-thread job。createRunThreadJob 自带去重,
  // 已有 queued/running 的 (session,object) 不会重复入队。
  // 这覆盖两种场景:
  // 1. server 启动后 jobManager 是空的,但磁盘上有 running thread(上次没跑完)
  // 2. 跨对象 talk:caller say 后 callee 变 running,但 executor 拿不到 jobManager,
  //    依赖这里把 callee 兜起来
  await enqueueOrphanRunningThreads(config);

  const jobs = config.jobManager.listJobs().filter((job) => job.status === "queued");

  for (const job of jobs) {
    config.jobManager.updateJob(job.jobId, {
      status: "running",
      startedAt: Date.now(),
      error: undefined,
    });

    try {
      await runner(job, config);
      config.jobManager.updateJob(job.jobId, {
        status: "done",
        finishedAt: Date.now(),
      });
    } catch (error) {
      config.jobManager.updateJob(job.jobId, {
        status: "failed",
        finishedAt: Date.now(),
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // 同一目的的事后扫描:本 job 中可能产生新的 callee running thread
    await enqueueOrphanRunningThreads(config, job.sessionId);
  }
}

/**
 * 扫指定 session(或全部 session) 的 running thread 入队 follow-up job。
 * 失败不抛,以保证 worker 循环不被一个坏 session 拖垮。
 */
async function enqueueOrphanRunningThreads(
  config: ServerConfig,
  onlySessionId?: string,
): Promise<void> {
  try {
    const sessionIds = onlySessionId ? [onlySessionId] : await listSessionIds(config.baseDir);
    for (const sessionId of sessionIds) {
      const running = await scanRunningThreads(config.baseDir, sessionId);
      for (const { objectId, threadId } of running) {
        if (objectId === USER_OBJECT_ID) continue;
        config.jobManager.createRunThreadJob({ sessionId, objectId, threadId });
      }
    }
  } catch {
    // swallow — 扫描失败不阻塞主循环
  }
}

async function listSessionIds(baseDir: string): Promise<string[]> {
  const { readdir } = await import("node:fs/promises");
  const { join } = await import("node:path");
  try {
    const entries = await readdir(join(baseDir, "flows"), { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
}

/**
 * 跨对象 callee end → caller 唤醒。
 *
 * 背景:scheduler.ts:emitChildEndNotifications 只处理 caller 自身 thread.childThreads
 * 树里的子线程结束(典型 do_window fork)。跨对象 talk 派生的 callee(super flow /
 * 普通 talk peer)落在另一个 objectId 目录,不在 childThreads 树,end 时 caller
 * 无信号 → 卡死 waiting。
 *
 * 本函数在 caller thread 跑 scheduler 之前调用:扫 caller 的 talk_window 列表,
 * 对每个有 targetThreadId 的 talk_window,readThread 对端;若 callee 处于 done/failed
 * 且 caller 正 waiting 在该 talk_window 上,写一条 system message 到 caller.inbox +
 * 翻 caller 状态回 running + 持久化。
 *
 * 幂等:用 `[talk:<windowId>:<status>@<lastExecutedAt>]` marker 去重,避免每次扫
 * 都写同样消息。callee 重启(status 切回 running 又 end)会因 lastExecutedAt 变化
 * 产生新 marker,允许再唤醒一次。
 */
async function syncCrossObjectCalleeEnds(
  caller: ThreadContext,
  baseDir: string,
  callerSessionId: string,
): Promise<void> {
  if (!caller.persistence) return;
  const talkWindows = (caller.contextWindows ?? []).filter(
    (w): w is TalkWindow => w.type === "talk" && Boolean(w.targetThreadId),
  );
  if (talkWindows.length === 0) return;

  let mutated = false;
  for (const w of talkWindows) {
    // super alias 是自指目标:派送到 caller 自身在 super session 下的 thread。
    // 这里的 callee 解析必须与 talk-delivery.ts 严格一致 — 否则 readThread 会
    // 读错路径(在 sessions/super/objects/super/ 找不到任何东西)。
    const isSuperAlias = w.target === SUPER_ALIAS_TARGET;
    const calleeObjectId = isSuperAlias ? caller.persistence.objectId : w.target;
    const calleeSessionId = isSuperAlias ? SUPER_SESSION_ID : callerSessionId;
    const calleeRef = { baseDir, sessionId: calleeSessionId, objectId: calleeObjectId };
    let callee: ThreadContext | undefined;
    try {
      callee = await readThread(calleeRef, w.targetThreadId!);
    } catch {
      continue;
    }
    if (!callee) continue;
    if (callee.status !== "done" && callee.status !== "failed") continue;

    const tail = callee.lastExecutedAt ?? 0;
    const marker = `[talk:${w.id}:${callee.status}@${tail}]`;
    const already = (caller.inbox ?? []).some((m) => (m.content ?? "").startsWith(marker));
    if (already) continue;

    const summary = callee.endSummary ?? "(无 summary)";
    const reason = callee.endReason ?? callee.status;
    const text = `${marker} ${reason} - ${summary}`;
    const msgId = `msg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    caller.inbox = [
      ...(caller.inbox ?? []),
      {
        id: msgId,
        fromThreadId: callee.id,
        toThreadId: caller.id,
        fromObjectId: calleeObjectId,
        content: text,
        createdAt: Date.now(),
        source: "system",
        replyToWindowId: w.id,
      },
    ];
    caller.events = [
      ...caller.events,
      { category: "context_change", kind: "inbox_message_arrived", msgId },
    ];
    mutated = true;
  }

  if (!mutated) return;

  // scheduler.wakeWaitingThreadsOnInbox 会在 runScheduler tick 内做 waiting → running 翻转,
  // 但 caller 此时仍是 waiting 状态;为了让 scheduler 第一时间看到新消息后能立即调度,
  // 这里也做一次翻转(等同于 scheduler 第一次 tick 的效果),并把 inboxSnapshotAtWait 清零
  if (caller.status === "waiting") {
    caller.status = "running";
    caller.inboxSnapshotAtWait = undefined;
    caller.waitingOn = undefined;
  }

  await writeThread(caller);
}

export function startJobWorker(config: ServerConfig): { stop(): void } {
  let processing = false;
  const interval = setInterval(() => {
    if (processing) return;
    processing = true;
    processQueuedJobs(config).finally(() => {
      processing = false;
    });
  }, config.workerPollMs);

  if (typeof interval.unref === "function") {
    interval.unref();
  }

  return {
    stop() {
      clearInterval(interval);
    },
  };
}
