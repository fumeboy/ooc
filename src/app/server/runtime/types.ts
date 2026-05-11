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
}
