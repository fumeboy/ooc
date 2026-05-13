import { endpoints } from "../../transport/endpoints";
import { requestJson } from "../../transport/http";
import type { ThreadContext } from "./model";

export function fetchThread(sessionId: string, objectId: string, threadId = "root") {
  return requestJson<ThreadContext>(endpoints.thread(sessionId, objectId, threadId));
}

export function continueThread(sessionId: string, objectId: string, text: string, threadId = "root") {
  return requestJson<{ jobId?: string }>(endpoints.continueThread(sessionId, objectId, threadId), {
    method: "POST",
    body: JSON.stringify({ text }),
  });
}

export function fetchJob(jobId: string) {
  return requestJson<{ status?: string }>(endpoints.job(jobId));
}

