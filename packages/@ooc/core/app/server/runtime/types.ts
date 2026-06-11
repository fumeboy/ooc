export interface RuntimeJobInput {
  sessionId: string;
  objectId: string;
  threadId: string;
}

export interface RuntimeJob extends RuntimeJobInput {
  jobId: string;
  kind: "run-thread" | "resume-thread";
  status: "queued" | "running" | "done" | "failed";
  startedAt?: number;
  finishedAt?: number;
  error?: string;
  /**
   * 结构化失败原因（observability）。
   *
   * 区分两类失败：
   * - "runner_error"：runner 抛异常（job 调度本身失败）
   * - thread 终态对账失败时取 thread.statusReason（如 "llm_timeout" / "think_error"）；
   *   缺失时为 "thread_failed"。
   *
   * 让 GET /api/runtime/jobs/:id 的调用方/UI 不必把 status="done" 误判成成功——
   * job 标 failed 时这里给出机读原因。
   */
  statusReason?: string;
}
