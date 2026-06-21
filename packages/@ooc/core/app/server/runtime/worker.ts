import { createLlmClient } from "@ooc/core/thinkable/llm/client";
import { resolveSuperActor } from "@ooc/core/persistable";
import { llmInputFile } from "@ooc/core/observable/debug-file";
import { readThread, writeThread } from "@ooc/builtins/agent/thread/persistable/thread-json.js";
import { runScheduler } from "@ooc/core/thinkable/scheduler";
import { detectInterruptedThread, markInterrupted } from "@ooc/core/thinkable/recovery";
import { stat } from "node:fs/promises";
import type { ServerConfig } from "../bootstrap/config";
import type { RuntimeJob } from "./types";
import type { ThreadContext } from "@ooc/core/thinkable/context";
import type { OocObjectInstance } from "@ooc/core/runtime/ooc-class.js";
import { SUPER_SESSION_ID, isSuperSessionId } from "@ooc/core/_shared/types/constants.js";

/**
 * talk 对象的会话视图字段（target / targetThreadId）。
 *
 * Wave 4：contextWindows 元素是 `OocObjectInstance`（信封 + data + win 分离）；talk 的会话业务
 * 字段落 `inst.data`（=TalkData）。本 helper 从 data 读出 target / targetThreadId。
 */
function talkView(inst: OocObjectInstance): { target?: string; targetThreadId?: string } {
  const data = (inst.data ?? {}) as { target?: string; targetThreadId?: string };
  return { target: data.target, targetThreadId: data.targetThreadId };
}
import { resumePausedThread } from "./resume";
import { listSessionIds, scanRunningThreads } from "./thread-query";

/**
 * runner 返回的 thread 终态对账结果（observability）。
 *
 * thinkloop 把 LLM 超时/异常**内部消化**（标 thread.status="failed" + 写 statusReason），
 * 不向 runner 抛 → runner 正常返回。若不对账，processQueuedJobs 会把 job 裸标 "done"，
 * 造成"job done 但 thread failed"的假成功。runner 返回 root thread 终态，让
 * processQueuedJobs 据此把 job 标 failed（带 statusReason）。
 *
 * undefined 表示无需对账（user object 跳过 / resume-thread 路径 / thread 不存在已抛错）。
 */
export interface RuntimeJobResult {
  threadStatus?: ThreadContext["status"];
  threadStatusReason?: string;
  threadLastError?: string;
}

export type RuntimeJobRunner = (job: RuntimeJob, config: ServerConfig) => Promise<RuntimeJobResult | void>;

/**
 * 约定值：user 是 web session 中的特殊 flow object，由控制面（人类）驱动；
 * worker 跳过它，让任何针对 user object 的 thread 都不被 LLM 调度。
 *
 * collaborable cross-object talk。
 */
const USER_OBJECT_ID = "user";

export async function runJob(
  job: RuntimeJob,
  config: Pick<ServerConfig, "baseDir" | "workerMaxTicks" | "jobManager">
): Promise<RuntimeJobResult | void> {
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

  // scheduler yield 留痕：runScheduler 跑满 maxTicks 自然返回时, 若 thread 仍 running,
  // 写一条 scheduler_yielded event 标记"还想继续但本批 tick 预算耗尽"。
  //
  // **续跑入队不在此处做**：此刻当前 job 仍是 running（processQueuedJobs 还没把它标 done），
  // 若现在调 createRunThreadJob，其 dedupe(findRunning queued|running) 会命中当前 job
  // 自己而吞掉续跑请求 → thread 永久冻结在 running（需外部 continue 才恢复；programmable
  // 长任务 >maxTicks 必然踩中）。改由 processQueuedJobs 在把当前 job 标 done **之后**续跑。
  if (rootThread.status === "running") {
    const rounds = rootThread.events.filter(
      (e) => e.category === "llm_interaction" && e.kind === "call_started",
    ).length;
    rootThread.events.push({
      category: "context_change",
      kind: "scheduler_yielded",
      reason: "max_ticks",
      rounds,
    });
    await writeThread(rootThread);
  }

  // scheduler 原地推进 rootThread 并落盘；返回其终态供 processQueuedJobs 对账。
  // thinkloop 把 LLM 超时/异常消化成 status="failed"（不抛），不对账就会被裸标 done。
  return {
    threadStatus: rootThread.status,
    threadStatusReason: rootThread.statusReason,
    threadLastError: rootThread.lastError,
  };
}

export async function processQueuedJobs(
  config: ServerConfig,
  runner: RuntimeJobRunner = runJob
): Promise<void> {
  // worker 事件驱动改造：worker 不再周期扫 fs 兜底入队。
  // 状态翻转（talk-delivery / do_window.continue / issue appendComment / resume /
  // end auto-reply）由事件源在写完目标 inbox 后直接调 notifyThreadActivated
  // → jobManager.createRunThreadJob。worker 只跑队列。
  //
  // 启动期兜底（捕获上次未跑完的 running thread）已迁到 bootstrap (enqueueRunningThreadsAtBootstrap)。
  const jobs = config.jobManager.listJobs().filter((job) => job.status === "queued");

  // **并行处理本批 queued jobs**: 此前是 for-await 串行, 当 caller
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
        const result = await runner(claimed, config);
        // thread 以 failed 收场时 job 不裸标 done — thinkloop 内部消化
        // LLM 超时/异常（不向 runner 抛），裸标 done 会造成"job done 但 thread failed"
        // 的假成功。对账 thread 终态：failed → job 标 failed + 带 statusReason。
        if (result?.threadStatus === "failed") {
          config.jobManager.updateJob(claimed.jobId, {
            status: "failed",
            finishedAt: Date.now(),
            statusReason: result.threadStatusReason ?? "thread_failed",
            error: result.threadLastError,
          });
        } else {
          config.jobManager.updateJob(claimed.jobId, {
            status: "done",
            finishedAt: Date.now(),
          });
          // scheduler yield 续跑：thread 跑满 maxTicks 仍 running（runScheduler 已写
          // scheduler_yielded 留痕）→ 当前 job 此刻已标 done，createRunThreadJob 的 dedupe
          // 不再命中当前 job，续跑 job 得以入队，下个 worker poll drain 它继续推进。
          // （放在 runJob 内当前 job 还 running 时入队会被 dedupe 自吞 → thread 冻结。）
          if (result?.threadStatus === "running") {
            config.jobManager.createRunThreadJob({
              sessionId: claimed.sessionId,
              objectId: claimed.objectId,
              threadId: claimed.threadId,
            });
          }
        }
      } catch (error) {
        config.jobManager.updateJob(claimed.jobId, {
          status: "failed",
          finishedAt: Date.now(),
          statusReason: "runner_error",
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
 * 启动后第一次扫一遍。**不**周期扫——周期扫已删除。
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
        await maybeMarkInterrupted(config.baseDir, sessionId, objectId, threadId);
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

/**
 * Bootstrap recovery: 检测上次 server crash / LLM hang 留下的"中断 thread"，写一条
 * inject event 告诉 LLM 上一轮 LLM 调用被打断，让 worker 把它正常入队后 LLM 看到
 * 标记会重试。不删 debug 文件（observability 资产）；不改 status（让常规 enqueue
 * 推进）。详见 src/thinkable/recovery.ts。
 */
async function maybeMarkInterrupted(
  baseDir: string,
  sessionId: string,
  objectId: string,
  threadId: string,
): Promise<void> {
  try {
    const ref = { baseDir, sessionId, objectId, threadId };
    const thread = await readThread(ref, threadId);
    if (!thread) return;
    let debugInputExists = false;
    try {
      await stat(llmInputFile(ref));
      debugInputExists = true;
    } catch {} // intentional: stat 仅探测 llm.input 是否存在；不存在(ENOENT)即 debugInputExists 保持 false
    const detection = detectInterruptedThread(thread, { debugInputExists });
    if (!detection.interrupted) return;
    markInterrupted(thread);
    await writeThread(thread);
  } catch (err) {
    console.warn(
      `[worker] maybeMarkInterrupted failed for ${sessionId}/${objectId}/${threadId}: ${err instanceof Error ? err.message : String(err)}`,
    );
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
    // talk 会话窗：class==="talk" 且有 targetThreadId（指向对端 thread）。字段经 talkView 兼读
    // 实例信封顶层 / inst.data（talk 迁移在途）。
    (w) => w.class === "talk" && Boolean(talkView(w).targetThreadId),
  );
  if (talkWindows.length === 0) return;

  let mutated = false;
  for (const w of talkWindows) {
    const view = talkView(w);
    // super alias 是自指目标:派送到 caller 自身在 super session 下的 thread。
    // 这里的 callee 解析必须与 talk-delivery.ts 严格一致 — 否则 readThread 会
    // 读错路径(在 sessions/super/objects/super/ 找不到任何东西)。
    // 与 talk-delivery.ts 同源判定（isSuperSessionId trim+lowercase 归一），逐字一致防大小写绕过。
    const isSuperAlias = isSuperSessionId(view.target ?? "");
    // super-alias 的 callee = super-flow actor。canonical caller → 自身（透明）；
    // 新对象（仅 session 内、未 canonical）→ 冒泡到最近 canonical 祖先（顶层兜底 supervisor），
    // 由其代为发起沉淀 super flow。必须与 talk-delivery.ts 严格一致（同 resolveSuperActor）。
    const calleeObjectId = isSuperAlias
      ? await resolveSuperActor(baseDir, caller.persistence.objectId)
      : view.target!;
    const calleeSessionId = isSuperAlias ? SUPER_SESSION_ID : callerSessionId;
    const calleeRef = { baseDir, sessionId: calleeSessionId, objectId: calleeObjectId };
    let callee: ThreadContext | undefined;
    try {
      callee = await readThread(calleeRef, view.targetThreadId!);
    } catch {
      continue;
    }
    if (!callee) continue;
    // 终态（含 canceled）才向 caller 回报：canceled callee 同 done/failed，不再运行、给出终态通知。
    if (
      callee.status !== "done" &&
      callee.status !== "failed" &&
      callee.status !== "canceled"
    )
      continue;

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
  // **每个 tick 独立并行进入**: 此前 `if (processing) return` guard 让
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

