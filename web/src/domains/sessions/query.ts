import { endpoints } from "../../transport/endpoints";
import { requestJson } from "../../transport/http";
import type { CreateSessionInput, CreatedFlowObject } from "./model";

export async function createSessionWithObject(input: CreateSessionInput) {
  await requestJson<{ sessionId: string }>(endpoints.flows, {
    method: "POST",
    body: JSON.stringify({ sessionId: input.sessionId, title: input.title || input.sessionId }),
  });
  return requestJson<CreatedFlowObject>(endpoints.createFlowObject(input.sessionId), {
    method: "POST",
    body: JSON.stringify({ objectId: input.objectId, initialMessage: input.initialMessage || undefined }),
  });
}

