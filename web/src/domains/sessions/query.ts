import { endpoints } from "../../transport/endpoints";
import { requestJson } from "../../transport/http";
import type { CreateSessionInput, CreatedSession } from "./model";

/**
 * Create session — adapted for ooc-3.
 * ooc-3 POST /api/talk creates a session + sends initial message synchronously.
 * Returns adapted CreatedSession shape.
 */
export async function createSessionWithObject(input: CreateSessionInput): Promise<CreatedSession> {
  // ooc-3: use /api/talk to seed session with first message
  const targetUri = `ooc://stones/main/objects/${encodeURIComponent(input.targetObjectId)}`;
  const res = await requestJson<{
    ok: boolean;
    sessionId: string;
    threadId: string;
    response?: string;
    threadStatus?: string;
  }>(endpoints.sessions === "/api/sessions" ? "/api/talk" : endpoints.sessions, {
    method: "POST",
    body: JSON.stringify({
      target: targetUri,
      content: input.initialMessage,
      sessionId: input.sessionId,
    }),
  });
  // Adapt to ooc-2 CreatedSession shape
  return {
    sessionId: res.sessionId,
    userThreadId: res.threadId,
    talkWindowId: res.threadId,
    targetObjectId: input.targetObjectId,
    targetThreadId: res.threadId,
    jobId: res.threadId,
  };
}
