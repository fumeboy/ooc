import { createLlmClient } from "@src/thinkable/llm/client";
import { readIssue, readThread, writeThread } from "@src/persistable";
import { runScheduler } from "@src/thinkable/scheduler";
import type { ServerConfig } from "../bootstrap/config";
import type { RuntimeJob } from "./types";
import type { ThreadContext, ThreadMessage } from "@src/thinkable/context";
import type { IssueWindow, TalkWindow } from "@src/executable/windows/_shared/types";
import { SUPER_ALIAS_TARGET, SUPER_SESSION_ID } from "@src/executable/windows/_shared/super-constants";
import { resumePausedThread } from "./resume";
import { scanRunningThreads } from "./thread-query";
import { readdir } from "node:fs/promises";
import { join } from "node:path";

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
  config: Pick<ServerConfig, "baseDir" | "stonesBranch" | "workerMaxTicks">
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
      stonesBranch: config.stonesBranch,
    });
    return;
  }

  const rootThread = await readThread(
    {
      baseDir: config.baseDir,
      sessionId: job.sessionId,
      objectId: job.objectId,
      stonesBranch: config.stonesBranch,
    },
    job.threadId
  );
  if (!rootThread) {
    throw new Error(`thread not found: ${job.threadId}`);
  }
  // 跑 scheduler 前先把"caller waiting on 已结束的 cross-object callee" 唤醒
  // (scheduler.emitChildEndNotifications 只覆盖 in-tree childThreads,无法跨 object)
  await syncCrossObjectCalleeEnds(rootThread, config.baseDir, job.sessionId, config.stonesBranch);
  // pull-on-tick:扫本 thread IssueWindow,发现新 comment 时按规则写 inbox
  // (push 主路径由 issuesService.appendComment 调 enqueueSubscribers 触发;
  //  本 sync 是兜底,覆盖 push 路径漏 enqueue / worker 重启等场景)
  await syncIssueWindowComments(rootThread, config.baseDir);
  await runScheduler(rootThread, createLlmClient(), { maxTicks: config.workerMaxTicks ?? 15 });
}

export async function processQueuedJobs(
  config: ServerConfig,
  runner: RuntimeJobRunner = runJob
): Promise<void> {
  // 根因 #5（worker 事件驱动改造，2026-05-24）：worker 不再周期扫 fs 兜底入队。
  // 状态翻转（talk-delivery / do_window.continue / issue appendComment / resume /
  // end auto-reply）由事件源在写完目标 inbox 后直接调 notifyThreadActivated
  // → jobManager.createRunThreadJob。worker 只跑队列。
  //
  // 启动期兜底（捕获上次未跑完的 running thread）已迁到 bootstrap (enqueueRunningThreadsAtBootstrap)。
  const jobs = config.jobManager.listJobs().filter((job) => job.status === "queued");

  // **并行处理本批 queued jobs** (2026-05-20 修): 此前是 for-await 串行, 当 caller
  // 在 thinkloop 内 await 跨 object talk 派生的 callee 回复时, callee 永远拿不到
  // schedule (因为 caller job 占着 worker, processing guard 阻止下一 tick 进入)。
  // 并行化让 caller / callee 同时跑 — LLM 调用是 IO bound, jobManager 用 atomic claim
  // 保证多 tick 并发进入也不会重复 process 同一 job。
  await Promise.all(
    jobs.map(async (job) => {
      // atomic claim — 如果别的并发 tick 已经 claim 这个 job, 跳过
      const claimed = config.jobManager.tryClaimQueuedJob(job.jobId);
      if (!claimed) return;

      try {
        await runner(claimed, config);
        config.jobManager.updateJob(claimed.jobId, {
          status: "done",
          finishedAt: Date.now(),
        });
      } catch (error) {
        config.jobManager.updateJob(claimed.jobId, {
          status: "failed",
          finishedAt: Date.now(),
          error: error instanceof Error ? error.message : String(error),
        });
      }
    })
  );
}

/**
 * Bootstrap-only：server 启动时调一次，把磁盘上 running/waiting 的 thread 入队。
 *
 * 用于：上次 server crash 留下的 orphan thread；workerEnabled=true 的 buildServer
 * 启动后第一次扫一遍。**不**周期扫——周期扫已在根因 #5 中删除。
 *
 * 失败不抛，保证 server 启动不被磁盘异常拖垮。
 */
export async function enqueueRunningThreadsAtBootstrap(
  config: Pick<ServerConfig, "baseDir" | "jobManager">,
): Promise<{ enqueued: number }> {
  let enqueued = 0;
  try {
    const sessionIds = await listSessionIds(config.baseDir);
    for (const sessionId of sessionIds) {
      const running = await scanRunningThreads(config.baseDir, sessionId);
      for (const { objectId, threadId } of running) {
        if (objectId === USER_OBJECT_ID) continue;
        config.jobManager.createRunThreadJob({ sessionId, objectId, threadId });
        enqueued += 1;
      }
    }
  } catch (err) {
    // bootstrap 期失败 warn 但不阻塞启动（silent-swallow ban → 显式 warn）
    console.warn(
      `[worker] enqueueRunningThreadsAtBootstrap failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  return { enqueued };
}

async function listSessionIds(baseDir: string): Promise<string[]> {
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
  stonesBranch?: string,
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
    const calleeRef = { baseDir, sessionId: calleeSessionId, objectId: calleeObjectId, stonesBranch };
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

/** 10s 限频窗口(ms);防止同 thread 同 IssueWindow 短时间内重复唤醒。 */
const ISSUE_NOTIFY_RATE_LIMIT_MS = 10_000;

/** 单条 inbox 消息 text 截断长度(避免 IssueComment 把 inbox 撑爆)。 */
const ISSUE_INBOX_TEXT_PREVIEW = 200;

/**
 * Issue pull-on-tick 同步:扫本 thread 的 IssueWindow,
 * 把新 comment 按 self-skip / @-mention / wait-all 规则注入 inbox。
 *
 * 规则(plan §4 决策 7 / A1 / F3):
 * - **self-skip(objectId 维度)**:authorObjectId === self.objectId → 不通知,
 *   只前进游标
 * - **wait-all 模式**:thread.status==="waiting" && thread.waitingOn === w.id →
 *   所有新 comment 都写 inbox,**绕过 10s 限频**(A1 修正)
 * - **mention 路径**:非 wait-all 时,只对 comment.mentions 含 self.objectId
 *   且非 self 作者的写 inbox
 * - **10s 限频(非 wait-all)**:lastNotifiedAt 在 10s 内则跳过 inbox 写(游标
 *   仍前进 — "自然吸收")
 * - **Issue close fallback**:issue.status==="closed" 且 window 仍在 →
 *   写一条 `[issue:N:closed] ...` 到 inbox,然后**移除 window**(F3 close=remove)
 * - **lastSeenCommentId === undefined**:重启或新挂 window → 初值=当前最新
 *   commentId(避免一启动就把历史 comment 全部当 new)
 *
 * 错误隔离:单 IssueWindow 出错 console.warn 后 continue,不抛阻塞 scheduler。
 */
async function syncIssueWindowComments(
  thread: ThreadContext,
  baseDir: string,
): Promise<void> {
  if (!thread.persistence) return;
  const { sessionId } = thread.persistence;
  const selfObjectId = thread.persistence.objectId;

  const issueWindows = (thread.contextWindows ?? []).filter(
    (w): w is IssueWindow => w.type === "issue",
  );
  if (issueWindows.length === 0) return;

  let mutated = false;
  const now = Date.now();

  for (const w of issueWindows) {
    try {
      const issue = await readIssue(baseDir, sessionId, w.issueId);
      if (!issue) continue;

      // Close fallback:Issue 已关闭且 window 仍在 → 写 inbox + 移除 window(F3)
      if (issue.status === "closed") {
        const text = `[issue:${w.issueId}:closed] ${issue.title.slice(0, 100)} 已关闭`;
        const msgId = `msg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
        thread.inbox = [...(thread.inbox ?? []), buildSystemInboxMessage(msgId, thread.id, text)];
        thread.events = [
          ...thread.events,
          { category: "context_change", kind: "inbox_message_arrived", msgId },
        ];
        // 移除本 IssueWindow(F3 close=remove)
        thread.contextWindows = (thread.contextWindows ?? []).filter((x) => x.id !== w.id);
        mutated = true;
        continue;
      }

      // 首次见到 / 重启 → 初值 lastSeenCommentId 不通知历史
      if (w.lastSeenCommentId === undefined) {
        w.lastSeenCommentId = issue.comments.length;
        continue;
      }

      const newComments = issue.comments.filter((c) => c.id > (w.lastSeenCommentId ?? 0));
      if (newComments.length === 0) continue;

      const isWaitAll = thread.status === "waiting" && thread.waitingOn === w.id;

      let toNotify: typeof newComments;
      if (isWaitAll) {
        toNotify = newComments;
      } else {
        // mention 模式:non-self 作者 + mention 含 self
        toNotify = newComments.filter(
          (c) => c.authorObjectId !== selfObjectId && (c.mentions ?? []).includes(selfObjectId),
        );
        // 10s 限频(非 wait-all 路径)— 跳过 inbox 写入但游标仍前进
        if (
          w.lastNotifiedAt !== undefined &&
          now - w.lastNotifiedAt < ISSUE_NOTIFY_RATE_LIMIT_MS
        ) {
          toNotify = [];
        }
      }

      for (const c of toNotify) {
        const text = `[issue:${w.issueId}:comment author=${c.authorObjectId} comment_id=${c.id}] ${c.text.slice(0, ISSUE_INBOX_TEXT_PREVIEW)}`;
        const msgId = `msg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}_${c.id}`;
        thread.inbox = [...(thread.inbox ?? []), buildSystemInboxMessage(msgId, thread.id, text)];
        thread.events = [
          ...thread.events,
          { category: "context_change", kind: "inbox_message_arrived", msgId },
        ];
      }

      if (toNotify.length > 0) w.lastNotifiedAt = now;
      // 游标始终前进到本批最新(吸收被限频跳过 / self / 非 mention 的 comment)
      w.lastSeenCommentId = newComments[newComments.length - 1]?.id ?? w.lastSeenCommentId;
      mutated = true;
    } catch (err) {
      console.warn(
        `[issue-sync] error window=${w.id} issueId=${w.issueId} msg=${(err as Error).message}`,
      );
    }
  }

  if (!mutated) return;

  // 如 wait-all 路径写了 inbox,顺手翻回 running(scheduler.wakeWaitingThreadsOnInbox
  // 也会在 tick 内做,这里提前翻让 scheduler 第一次 tick 立刻调度)
  if (
    thread.status === "waiting" &&
    (thread.inbox?.length ?? 0) > (thread.inboxSnapshotAtWait ?? 0)
  ) {
    thread.status = "running";
    thread.inboxSnapshotAtWait = undefined;
    thread.waitingOn = undefined;
  }

  await writeThread(thread);
}

function buildSystemInboxMessage(msgId: string, toThreadId: string, content: string): ThreadMessage {
  return {
    id: msgId,
    fromThreadId: "__system__",
    toThreadId,
    fromObjectId: "__system__",
    content,
    createdAt: Date.now(),
    source: "system",
  };
}

export function startJobWorker(config: ServerConfig): { stop(): void } {
  // **每个 tick 独立并行进入** (2026-05-20 修): 此前 `if (processing) return` guard 让
  // 当一个 tick 内 caller thinkloop 跑很久 (workerMaxTicks 默认 15 * LLM ~30s/tick) 时,
  // 后续所有 tick 全部 skip, 跨 object talk 派生的 super callee 永远等不到 schedule。
  // 改为允许多 tick 并发, jobManager.tryClaimQueuedJob 用 atomic claim 保证不重复处理.
  const interval = setInterval(() => {
    processQueuedJobs(config).catch((err) => {
      // 不抛, 不让一次失败拖垮整个 setInterval
      console.error("[worker] processQueuedJobs error:", err);
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

/** Test-only export of internal syncIssueWindowComments(integration tests). */
export const syncIssueWindowCommentsForTest = syncIssueWindowComments;
