import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  disableDebug,
  enableDebug,
  getDebugStatus,
  notifyThreadActivated,
} from "@ooc/core/observable";
import { logPatternSnapshot, type LogPattern } from "@ooc/core/observable/log-aggregator";
import {
  rollback,
  SUPERVISOR_OBJECT_ID,
  threadDir,
  type ThreadPersistenceRef,
} from "@ooc/core/persistable";
import {
  aggregatePrApproval,
  readPrIssue,
  readPrIssueIndex,
  type PrApproveAction,
  type PrApprovalVerdict,
  type PrIssueRecord,
} from "@ooc/builtins/agent/pr/persistable/pr-issue";
import { resolvePrIssue, type PrIssueDecision } from "@ooc/builtins/agent/pr/resolve";
import {
  llmInputFile,
  llmOutputFile,
  loopInputFile,
  loopMetaFile,
  loopOutputFile,
} from "@ooc/core/observable/debug-file";
import { readThread, writeThread } from "@ooc/core/persistable/thread-container-io.js";
import { applyPrApproval } from "@ooc/builtins/agent/pr/approval-flow";
import type { ListLoopsResponse, LoopListEntry, LoopMeta } from "./model";
import { readLlmEnv } from "@ooc/core/thinkable/llm/env";
import type { PauseStore } from "../../runtime/pause-store";
import type { createJobManager } from "../../runtime/job-manager";
import type { RuntimeJob } from "../../runtime/types";
import { resumeAllPausedThreads } from "../../runtime/resume-orchestration";
import { AppServerError } from "../../bootstrap/errors";

/** 读 debug JSON：缺失 → 404 NOT_FOUND；损坏 → 500 INTERNAL_ERROR。 */
async function readDebugJson(file: string, label: string, details: Record<string, unknown>): Promise<unknown> {
  let raw;
  try {
    raw = await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new AppServerError(
        "NOT_FOUND",
        `debug file '${label}' not found`,
        { ...details, file }
      );
    }
    throw new AppServerError(
      "INTERNAL_ERROR",
      `failed to read debug file '${label}': ${(error as Error).message}`,
      { ...details, file }
    );
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new AppServerError(
      "INTERNAL_ERROR",
      `debug file '${label}' contains invalid JSON: ${(error as Error).message}`,
      { ...details, file }
    );
  }
}

/** 活动快照里的单个 job（RuntimeJob + 派生 ageMs）。 */
export interface RuntimeActivityJob extends RuntimeJob {
  /** 仅 running job：now - startedAt（ms），一眼看出跑了多久（定位长跑/卡住）。 */
  ageMs?: number;
}

/** 系统活动快照（getActivity 返回）。 */
export interface RuntimeActivitySnapshot {
  /** 快照时刻（ms）。 */
  now: number;
  /** 在跑/排队/最近结束的 job（running 带 ageMs）。 */
  jobs: RuntimeActivityJob[];
  /** running job 数（快速判断系统是否在动）。 */
  runningCount: number;
  /** 主导日志模式（按次数降序 top-K），定位刷屏/重复事件。 */
  logPatterns: LogPattern[];
}

/** list view：单条 PR-Issue 摘要（reviewers/approvals/verdict 概览）。 */
export interface PrIssueSummaryView {
  id: number;
  title: string;
  status: "open" | "closed";
  createdByObjectId: string;
  createdAt: number;
  lastUpdatedAt: number;
  /** feat-branch PR 才有；非 PR record（recovery-needed）为 false。 */
  isPr: boolean;
  branch?: string;
  reviewers: string[];
  approvals: Record<string, string>;
  verdict: PrApprovalVerdict;
}

/** get view：单条 PR-Issue 全量（含 diff/intent/paths）。 */
export interface PrIssueDetailView extends PrIssueSummaryView {
  description?: string;
  intent?: string;
  diff?: string;
  paths: string[];
  baseSha?: string;
  /** 发起沉淀的 super(foo) threadId（回修目标 thread）；磁盘 prPayload 有，view 此前漏。 */
  authorThreadId?: string;
}

export interface RuntimeService {
  getLlmConfig(): {
    configured: boolean;
    provider: string;
    baseUrl: string;
    model: string;
    error?: string;
  };
  listJobs(): { items: RuntimeJob[] };
  getJob(jobId: string): RuntimeJob | undefined;
  /**
   * 系统活动快照（observable 诊断原语）：一次读出服务端此刻全貌——
   * 在跑/排队的 job（含 ageMs，定位「卡住多久」）+ 主导日志模式（来自 log-aggregator，
   * 定位「被什么重复事件刷屏」）。供 /api/runtime/activity 端点 / harness 超时快照消费，
   * 把「盲等到超时」变成「超时即可诊断」。
   */
  getActivity(): RuntimeActivitySnapshot;
  enableGlobalPause(): { enabled: true };
  /**
   * 解除全局 pause：翻 flag + **扫所有 session 的 paused thread 入队 resume-thread job**
   * （修 pause 单向陷阱）。此前只翻内存 flag，已 paused 的 thread 永久搁浅。
   */
  disableGlobalPause(): Promise<{ enabled: false }>;
  getGlobalPauseStatus(): { enabled: boolean };
  enableDebug(): { enabled: true };
  disableDebug(): { enabled: false };
  getDebugStatus(): { enabled: boolean };
  getLatestDebug(ref: ThreadPersistenceRef): Promise<{ input: unknown; output: unknown }>;
  getLoopDebug(ref: ThreadPersistenceRef, loopIndex: number): Promise<{ input: unknown; output: unknown; meta: unknown }>;
  /**
   * 列出指定 thread 下 debug/ 目录里所有 loop_NNNN.{input,output,meta}.json
   * 文件, 按 loopIndex 升序返回. 不携带 input/output 全文 (前端按需 GET 单条).
   *
   * 退化路径 (返回 { loops: [] }, 不抛):
   * - debug/ 目录不存在 (debug 从未启用)
   * - readdir 失败 (权限错误等)
   * - persistence 缺失
   *
   * meta.json 损坏 (非合法 JSON) → 该条目 hasMeta=true 但 meta=undefined.
   */
  listLoops(ref: ThreadPersistenceRef): Promise<ListLoopsResponse>;
  /**
   * HITL approve/reject。
   *
   * 接收来自控制面 / 测试 fixture 的决议, 把 thread.events 中最近一条 (或 eventId
   * 指定的) permission_ask 标记 decided + 翻 status="paused"→"running" + 调
   * notifyThreadActivated 让 worker 重新调度该 thread; thinkloop 在下一轮入口
   * 由 processDecidedPermissionAsks 消费 decided 字段, approve 直接重放, reject 写
   * permission_denied + 合成 function_call_output。
   */
  decidePermission(args: {
    ref: ThreadPersistenceRef;
    eventId?: string;
    action: "approve" | "reject";
    reason?: string;
  }): Promise<{
    ok: true;
    threadId: string;
    eventId: string;
    newStatus: "running";
  }>;
  /**
   * 治理（去固化 metaprog method 后）：经控制面以 supervisor 治理身份
   * 标 PR-Issue 决议。底层走 persistable 的 resolvePrIssue（保留不动）。失败转 AppServerError：
   * NOT_FOUND / INVALID_STATE → 4xx，git/issue-service 失败 → 5xx。
   */
  resolvePrIssue(args: {
    issueId: number;
    decision: PrIssueDecision;
  }): Promise<Record<string, unknown>>;
  /**
   * 多 reviewer 审批：某 reviewer 对 PR 行使 approve/reject/request-changes。
   * 校验 reviewerObjectId ∈ record.reviewers（非 reviewer → CONFLICT 409）；写 approvals；
   * 按聚合 verdict + `.world.json` prAutoMerge 闸决定后续：
   *   - rejected         → 调 resolvePrIssue(reject) archive 分支 + close
   *   - ready-to-merge   → prAutoMerge=true 立即 resolvePrIssue(merge)；false 留 open（待人工 resolve）
   *   - changes-requested / pending → 仅记录，留 open
   * 失败转 AppServerError：NOT_FOUND → 404 / INVALID_STATE → 409 / NOT_A_REVIEWER → 409。
   */
  approvePrIssue(args: {
    issueId: number;
    reviewerObjectId: string;
    action: PrApproveAction;
  }): Promise<{
    ok: true;
    verdict: PrApprovalVerdict;
    /** ready-to-merge 时由 prAutoMerge 决定：true=已合入 / false=待人工确认。 */
    merged?: boolean;
    /** verdict=rejected 时：已 archive 分支。 */
    rejected?: boolean;
    commitSha?: string;
    archivedRef?: string;
  }>;
  /**
   * 可观测：列出所有 PR-Issue（读 index.json + 逐条 reviewers/approvals 摘要）。
   * 补体验官实证 404 的缺口。
   */
  listPrIssues(): Promise<{ items: PrIssueSummaryView[] }>;
  /**
   * 可观测：单条 PR-Issue 全量（intent/diff/paths/branch/reviewers/approvals/status/verdict）。
   * 未知 issue → NOT_FOUND 404。
   */
  getPrIssue(issueId: number): Promise<PrIssueDetailView>;
  /**
   * 治理（去固化 metaprog method 后）：经控制面以 supervisor 治理身份
   * 回滚某 Object 的 stone 到先前 commit。底层走 persistable 的 rollback（保留不动），
   * supervisorAuthor 固定 SUPERVISOR_OBJECT_ID。失败转 AppServerError：INVALID_INPUT /
   * FORBIDDEN → 4xx，git 失败 → 5xx。
   */
  rollbackStone(args: {
    objectId: string;
    targetCommit: string;
  }): Promise<{ ok: true; commitSha: string }>;
}

/** PrIssueRecord → list 摘要视图。 */
function toPrIssueSummaryView(issue: PrIssueRecord): PrIssueSummaryView {
  const reviewers = issue.reviewers ?? [];
  const approvals = issue.approvals ?? {};
  return {
    id: issue.id,
    title: issue.title,
    status: issue.status,
    createdByObjectId: issue.createdByObjectId,
    createdAt: issue.createdAt,
    lastUpdatedAt: issue.lastUpdatedAt,
    isPr: issue.prPayload != null,
    ...(issue.prPayload ? { branch: issue.prPayload.branch } : {}),
    reviewers,
    approvals,
    verdict: aggregatePrApproval(reviewers, issue.approvals),
  };
}

/** PrIssueRecord → get 全量视图（含 diff/intent/paths）。 */
function toPrIssueDetailView(issue: PrIssueRecord): PrIssueDetailView {
  return {
    ...toPrIssueSummaryView(issue),
    ...(issue.description !== undefined ? { description: issue.description } : {}),
    ...(issue.prPayload
      ? {
          intent: issue.prPayload.intent,
          diff: issue.prPayload.diff,
          baseSha: issue.prPayload.baseSha,
          paths: issue.prPayload.paths,
          ...(issue.prPayload.authorThreadId !== undefined
            ? { authorThreadId: issue.prPayload.authorThreadId }
            : {}),
        }
      : { paths: [] }),
  };
}

/** index entry → 摘要 fallback（record 文件读不到时；理论不该发生，fail-safe 不抛）。 */
function entrySummaryFallback(entry: {
  id: number;
  title: string;
  status: "open" | "closed";
  createdByObjectId: string;
  createdAt: number;
  lastUpdatedAt: number;
}): PrIssueSummaryView {
  return {
    ...entry,
    isPr: false,
    reviewers: [],
    approvals: {},
    verdict: "pending",
  };
}

export function createRuntimeService(deps: {
  baseDir: string;
  pauseStore: PauseStore;
  jobManager: ReturnType<typeof createJobManager>;
}): RuntimeService {
  return {
    getLlmConfig() {
      try {
        const config = readLlmEnv();
        return {
          configured: true,
          provider: config.provider,
          baseUrl: config.baseUrl,
          model: config.model,
        };
      } catch (error) {
        return {
          configured: false,
          provider: process.env.OOC_PROVIDER ?? "openai",
          baseUrl: process.env.OOC_BASE_URL ?? "",
          model: process.env.OOC_MODEL ?? "",
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
    listJobs() {
      return { items: deps.jobManager.listJobs() };
    },
    getJob(jobId: string) {
      return deps.jobManager.getJob(jobId);
    },
    getActivity() {
      const now = Date.now();
      const jobs: RuntimeActivityJob[] = deps.jobManager.listJobs().map((j) =>
        j.status === "running" && j.startedAt != null
          ? { ...j, ageMs: now - j.startedAt }
          : { ...j },
      );
      const runningCount = jobs.filter((j) => j.status === "running").length;
      return { now, jobs, runningCount, logPatterns: logPatternSnapshot() };
    },
    enableGlobalPause() {
      deps.pauseStore.enableGlobalPause();
      return { enabled: true as const };
    },
    async disableGlobalPause() {
      deps.pauseStore.disableGlobalPause();
      // 对称于 enable：global pause 跨 session 停 thread，解除也跨 session 恢复。
      // 复用 flows.resumeSession 同款编排（scan paused → applyResumeTransition →
      // createResumeThreadJob），worker 消费 resume-thread job 续跑。
      await resumeAllPausedThreads({
        baseDir: deps.baseDir,
        jobManager: deps.jobManager,
      });
      return { enabled: false as const };
    },
    getGlobalPauseStatus() {
      return { enabled: deps.pauseStore.isGlobalPauseEnabled() };
    },
    enableDebug() {
      enableDebug();
      return { enabled: true as const };
    },
    disableDebug() {
      disableDebug();
      return { enabled: false as const };
    },
    getDebugStatus() {
      return getDebugStatus();
    },
    async getLatestDebug(ref: ThreadPersistenceRef) {
      const details = {
        sessionId: ref.sessionId,
        objectId: ref.objectId,
        threadId: ref.threadId,
      };
      return {
        input: await readDebugJson(llmInputFile(ref), "llm.input.json", details),
        output: await readDebugJson(llmOutputFile(ref), "llm.output.json", details),
      };
    },
    async decidePermission({
      ref,
      eventId,
      action,
      reason,
    }: {
      ref: ThreadPersistenceRef;
      eventId?: string;
      action: "approve" | "reject";
      reason?: string;
    }) {
      const details = {
        sessionId: ref.sessionId,
        objectId: ref.objectId,
        threadId: ref.threadId,
      };
      const thread = await readThread(ref, ref.threadId);
      if (!thread) {
        throw new AppServerError(
          "NOT_FOUND",
          `thread '${ref.threadId}' not found`,
          details,
        );
      }
      if (thread.status !== "paused") {
        throw new AppServerError(
          "THREAD_NOT_PAUSED",
          `thread '${ref.threadId}' is not paused (current=${thread.status}); cannot accept permission decision`,
          { ...details, currentStatus: thread.status },
        );
      }
      // 找目标 permission_ask event。
      // - 给定 eventId: 精确匹配; 找不到 → 404; 已 decided → 400 already-decided
      // - 未给定: 倒序找最近一条无 decided 的 ask
      type PermAskEvent = Extract<
        (typeof thread.events)[number],
        { category: "permission"; kind: "permission_ask" }
      >;
      let target: PermAskEvent | undefined;
      if (eventId) {
        target = thread.events.find(
          (e): e is PermAskEvent =>
            e.category === "permission" &&
            e.kind === "permission_ask" &&
            e.id === eventId,
        );
        if (!target) {
          throw new AppServerError(
            "NOT_FOUND",
            `permission_ask event '${eventId}' not found on thread '${ref.threadId}'`,
            { ...details, eventId },
          );
        }
        if (target.decided) {
          throw new AppServerError(
            "CONFLICT",
            `permission_ask event '${eventId}' already decided (action=${target.decided.action})`,
            { ...details, eventId, existingDecision: target.decided.action },
          );
        }
      } else {
        for (let i = thread.events.length - 1; i >= 0; i -= 1) {
          const ev = thread.events[i];
          if (
            ev.category === "permission" &&
            ev.kind === "permission_ask" &&
            !ev.decided
          ) {
            target = ev as PermAskEvent;
            break;
          }
        }
        if (!target) {
          throw new AppServerError(
            "INVALID_INPUT",
            `no pending permission_ask event on thread '${ref.threadId}'`,
            details,
          );
        }
      }
      // 标 decided + 翻 status + writeThread（不可变：新建 decided event 替换 target，不原地改）
      // 为 event 分配稳定 id (用于本次返回值; 若没有 id 字段则赋一个)。
      // 缺省策略: 用 toolCallId + "-ask" 作 fallback (toolCallId 在 thread.events 中
      // 仅出现一次, 在 permission_ask + function_call_output 间复用 — 给本 event 一个
      // 派生 id 即可)。
      const decidedId = target.id ?? `${target.toolCallId}_ask`;
      const decidedEvent = {
        ...target,
        id: decidedId,
        decided: {
          action,
          at: Date.now(),
          ...(reason !== undefined ? { reason } : {}),
        },
      };
      const updated = {
        ...thread,
        events: thread.events.map((ev) => (ev === target ? decidedEvent : ev)),
        status: "running" as const,
      };
      await writeThread(updated);
      // 触发 worker 调度 (与 talk-delivery / end auto-reply 同款唤醒路径)
      notifyThreadActivated({
        sessionId: ref.sessionId,
        objectId: ref.objectId,
        threadId: ref.threadId,
      });
      return {
        ok: true as const,
        threadId: ref.threadId,
        eventId: decidedId,
        newStatus: "running" as const,
      };
    },
    async resolvePrIssue({ issueId, decision }: { issueId: number; decision: PrIssueDecision }) {
      const r = await resolvePrIssue({ baseDir: deps.baseDir, issueId, decision });
      if (!r.ok) {
        if (r.code === "NOT_FOUND") {
          throw new AppServerError("NOT_FOUND", r.message, { issueId, decision });
        }
        if (r.code === "INVALID_STATE") {
          throw new AppServerError("CONFLICT", r.message, { issueId, decision });
        }
        if (r.code === "ISSUE_SERVICE") {
          throw new AppServerError("INTERNAL_ERROR", r.message, { issueId, decision });
        }
        // code === "GIT"
        throw new AppServerError(
          "INTERNAL_ERROR",
          `resolvePrIssue git failure (${r.gitCode}): ${r.stderr}`,
          { issueId, decision, gitCode: r.gitCode },
        );
      }
      return {
        ok: true,
        kind: r.kind,
        ...("commitSha" in r ? { commitSha: r.commitSha } : {}),
        ...("archivedRef" in r ? { archivedRef: r.archivedRef } : {}),
      };
    },
    async approvePrIssue({
      issueId,
      reviewerObjectId,
      action,
    }: {
      issueId: number;
      reviewerObjectId: string;
      action: PrApproveAction;
    }) {
      // 聚合 + 合入闸 + 回修编排统一走 applyPrApproval（与 pr_window method 同源，
      // 不两处漂移）。verdict=rejected/changes-requested/合入失败时其内部把回修 message 回投
      // super(foo)。
      const r = await applyPrApproval({
        baseDir: deps.baseDir,
        issueId,
        reviewerObjectId,
        action,
      });
      if (!r.ok) {
        if (r.code === "NOT_FOUND") {
          throw new AppServerError("NOT_FOUND", r.message, { issueId, reviewerObjectId, action });
        }
        if (r.code === "GIT") {
          throw new AppServerError("INTERNAL_ERROR", r.message, { issueId, reviewerObjectId, action });
        }
        // INVALID_STATE / NOT_A_REVIEWER → 409 CONFLICT
        throw new AppServerError("CONFLICT", r.message, { issueId, reviewerObjectId, action });
      }
      return {
        ok: true as const,
        verdict: r.verdict,
        ...(r.merged !== undefined ? { merged: r.merged } : {}),
        ...(r.rejected !== undefined ? { rejected: r.rejected } : {}),
        ...(r.commitSha ? { commitSha: r.commitSha } : {}),
        ...(r.archivedRef ? { archivedRef: r.archivedRef } : {}),
      };
    },
    async listPrIssues() {
      const index = await readPrIssueIndex(deps.baseDir);
      const items = await Promise.all(
        index.issues.map(async (entry) => {
          const issue = await readPrIssue(deps.baseDir, entry.id);
          return issue ? toPrIssueSummaryView(issue) : entrySummaryFallback(entry);
        }),
      );
      return { items };
    },
    async getPrIssue(issueId: number) {
      const issue = await readPrIssue(deps.baseDir, issueId);
      if (!issue) {
        throw new AppServerError("NOT_FOUND", `PR-Issue #${issueId} not found`, { issueId });
      }
      return toPrIssueDetailView(issue);
    },
    async rollbackStone({ objectId, targetCommit }: { objectId: string; targetCommit: string }) {
      const r = await rollback({
        baseDir: deps.baseDir,
        objectId,
        targetCommit,
        supervisorAuthor: SUPERVISOR_OBJECT_ID,
      });
      if (!r.ok) {
        if (r.code === "INVALID_INPUT") {
          throw new AppServerError("INVALID_INPUT", r.message, { objectId, targetCommit });
        }
        if (r.code === "FORBIDDEN") {
          throw new AppServerError("CONFLICT", r.message, { objectId, targetCommit });
        }
        // code === "GIT"
        throw new AppServerError(
          "INTERNAL_ERROR",
          `rollback git failure (${r.gitCode}): ${r.stderr}`,
          { objectId, targetCommit, gitCode: r.gitCode },
        );
      }
      return { ok: true as const, commitSha: r.commitSha };
    },
    async getLoopDebug(ref: ThreadPersistenceRef, loopIndex: number) {
      const details = {
        sessionId: ref.sessionId,
        objectId: ref.objectId,
        threadId: ref.threadId,
        loopIndex,
      };
      // label 与磁盘 zero-pad 4 位文件名对齐（loop_0001.*.json），
      // 而不是用裸 loopIndex（如 loop_1）——后者让错误信息无法直接指向文件。
      const padded = String(loopIndex).padStart(4, "0");
      return {
        input: await readDebugJson(loopInputFile(ref, loopIndex), `loop_${padded}.input.json`, details),
        output: await readDebugJson(loopOutputFile(ref, loopIndex), `loop_${padded}.output.json`, details),
        meta: await readDebugJson(loopMetaFile(ref, loopIndex), `loop_${padded}.meta.json`, details),
      };
    },
    async listLoops(ref: ThreadPersistenceRef): Promise<ListLoopsResponse> {
      const dir = join(threadDir(ref), "debug");
      let entries: string[];
      try {
        entries = await readdir(dir);
      } catch (error) {
        // 退化路径: ENOENT (debug 目录不存在) / EACCES (权限) / ENOTDIR / 其它 fs 错
        // 一律视为 "无 loop 数据", 返回空数组而非 throw — 让前端在 debug 关闭场景
        // 也能拿到稳定的 200 响应.
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          return { loops: [] };
        }
        return { loops: [] };
      }

      // 按 loopIndex 聚合 input/output/meta 三类文件
      const loopMap = new Map<number, LoopListEntry>();
      const metaFiles = new Map<number, string>(); // loopIndex → meta 文件名 (用于第二轮读)

      // 匹配 loop_NNNN.{input|output|meta}.json (允许 NNNN 是任意长度数字, 与
      // formatLoopIndex 的 4 位 padStart 兼容但不强绑死).
      const pattern = /^loop_(\d+)\.(input|output|meta)\.json$/;
      for (const fname of entries) {
        const match = pattern.exec(fname);
        if (!match) continue;
        const loopIndex = Number.parseInt(match[1]!, 10);
        if (!Number.isFinite(loopIndex)) continue;
        const kind = match[2] as "input" | "output" | "meta";
        const current = loopMap.get(loopIndex) ?? {
          loopIndex,
          hasInput: false,
          hasOutput: false,
          hasMeta: false,
        };
        const next: LoopListEntry = {
          ...current,
          ...(kind === "input" ? { hasInput: true } : {}),
          ...(kind === "output" ? { hasOutput: true } : {}),
          ...(kind === "meta" ? { hasMeta: true } : {}),
        };
        loopMap.set(loopIndex, next);
        if (kind === "meta") {
          metaFiles.set(loopIndex, fname);
        }
      }

      // 读取所有 meta.json (并行); 损坏的 meta → 该条目 meta 字段保持 undefined,
      // hasMeta 仍为 true (区分 "存在但损坏" vs "不存在").
      const loops: LoopListEntry[] = [];
      const sortedIndices = Array.from(loopMap.keys()).sort((a, b) => a - b);
      const reads = await Promise.all(
        sortedIndices.map(async (idx): Promise<LoopMeta | undefined> => {
          const fname = metaFiles.get(idx);
          if (!fname) return undefined;
          try {
            const raw = await readFile(join(dir, fname), "utf8");
            return JSON.parse(raw) as LoopMeta;
          } catch {
            // meta 文件损坏 / 读失败 → 返回 undefined, 不抛
            return undefined;
          }
        }),
      );
      for (let i = 0; i < sortedIndices.length; i += 1) {
        const idx = sortedIndices[i]!;
        const entry = loopMap.get(idx)!;
        const meta = reads[i];
        loops.push(meta !== undefined ? { ...entry, meta } : entry);
      }
      return { loops };
    },
  };
}
