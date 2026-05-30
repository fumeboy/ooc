import { endpoints } from "../../transport/endpoints";
import { requestJson } from "../../transport/http";
import { threadToContext, type ThreadContext } from "./model";

/**
 * Fetch a thread from ooc-3 backend and convert to ThreadContext shape.
 * ooc-3 endpoint: GET /api/flows/:sid/objects/:oid/threads/:tid
 */
export async function fetchThread(
  sessionId: string,
  objectId: string,
  threadId: string,
): Promise<ThreadContext | null> {
  try {
    const res = await requestJson<{
      ok: boolean;
      source: string;
      thread: import("./model").ThinkThread;
    }>(endpoints.thread(sessionId, objectId, threadId));
    if (!res?.thread) return null;
    return threadToContext(res.thread);
  } catch {
    return null;
  }
}

/**
 * Continue thread — POST /api/flows/:sid/continue (ooc-3 sync wrapper).
 * Returns { jobId, sessionId, threadId }.
 * jobId == threadId; GET /api/runtime/jobs/:jobId always returns "done".
 */
export async function continueThread(
  sessionId: string,
  text: string,
): Promise<{ jobId: string; sessionId: string; threadId: string }> {
  return requestJson<{ ok: boolean; jobId: string; sessionId: string; threadId: string }>(
    endpoints.continueThread(sessionId),
    {
      method: "POST",
      body: JSON.stringify({ text }),
    },
  );
}

/** Poll job status. In ooc-3 this always returns "done" immediately. */
export async function fetchJob(jobId: string): Promise<{ status: "running" | "done" | "failed" }> {
  return requestJson<{ ok: boolean; status: "running" | "done" | "failed" }>(endpoints.job(jobId));
}

/**
 * Fetch session threads list.
 * Response: { items: [{ objectId, threadId, status? }] }
 */
export async function fetchSessionThreads(
  sessionId: string,
): Promise<{ items: Array<{ objectId: string; threadId: string; status?: string }> }> {
  const res = await requestJson<{
    ok: boolean;
    items: Array<{ objectId: string; threadId: string; status?: string }>;
  }>(endpoints.sessionThreads(sessionId));
  return { items: res.items ?? [] };
}

/**
 * Wait for job to complete. In ooc-3, /continue is synchronous so jobId is always done.
 */
export async function waitForJob(
  jobId: string,
  fetchJobFn: (id: string) => Promise<{ status: string }>,
  opts?: { maxPollMs?: number; pollIntervalMs?: number },
): Promise<void> {
  const maxMs = opts?.maxPollMs ?? 120_000;
  const interval = opts?.pollIntervalMs ?? 500;
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    const result = await fetchJobFn(jobId);
    if (result.status === "done" || result.status === "failed") return;
    await new Promise<void>((r) => setTimeout(r, interval));
  }
}
