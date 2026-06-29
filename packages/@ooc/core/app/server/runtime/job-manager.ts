/**
 * job-manager — 进程内 job 实体表 + 状态机 (S7, 2026-06-29)。
 *
 * **设计权威**: app/self.md ## runtime:
 *   "job: worker 调度的一次任务(kind=run-thread/resume-thread, 状态机
 *   queued → running → done|failed)"
 *
 * worker.ts 的 busy/pending 机制是**真实推进力**, job-manager 是其**只读观测视图** —
 * 服务 HTTP 控制面 (`GET /api/runtime/jobs/<id>`) 给前端 polling thread 状态。
 *
 * 进程内单例, server 重启即丢 (与 worker map / pause-store 同语义)。
 */

export type JobKind = "run-thread" | "resume-thread";
export type JobStatus = "queued" | "running" | "done" | "failed";

export interface Job {
  id: string;
  kind: JobKind;
  sessionId: string;
  status: JobStatus;
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
  error?: string;
}

let jobCounter = 0;
const jobs = new Map<string, Job>();

function newJobId(): string {
  jobCounter += 1;
  return `job_${Date.now().toString(36)}_${jobCounter.toString(36)}`;
}

/** 创建一个 queued job。返回 Job (含 id)。 */
export function createJob(kind: JobKind, sessionId: string): Job {
  const job: Job = {
    id: newJobId(),
    kind,
    sessionId,
    status: "queued",
    createdAt: Date.now(),
  };
  jobs.set(job.id, job);
  return job;
}

/** queued → running (in-place mutate)。 */
export function startJob(id: string): void {
  const job = jobs.get(id);
  if (!job) return;
  job.status = "running";
  job.startedAt = Date.now();
}

/** running → done | failed (in-place mutate)。 */
export function finishJob(id: string, ok: boolean, error?: string): void {
  const job = jobs.get(id);
  if (!job) return;
  job.status = ok ? "done" : "failed";
  job.finishedAt = Date.now();
  if (!ok && error) job.error = error;
}

export function getJob(id: string): Job | undefined {
  return jobs.get(id);
}

/** 列出全部 job (可选 sessionId 过滤)。 */
export function listJobs(sessionId?: string): Job[] {
  const out: Job[] = [];
  for (const job of jobs.values()) {
    if (sessionId && job.sessionId !== sessionId) continue;
    out.push(job);
  }
  return out;
}

/** 清空 (测试/shutdown 用)。 */
export function clearJobs(): void {
  jobs.clear();
  jobCounter = 0;
}
