import { endpoints } from "../../transport/endpoints";
import { requestJson } from "../../transport/http";
import type { FlowSession } from "./model";

export function fetchFlows() {
  return requestJson<{ items: FlowSession[] }>(endpoints.flows);
}

export function pauseFlowSession(sessionId: string) {
  return requestJson<{ sessionId: string; paused: true }>(endpoints.pauseSession(sessionId), {
    method: "POST",
  });
}

export function resumeFlowSession(sessionId: string) {
  return requestJson<{ sessionId: string; paused: false; resumedThreadIds: string[]; jobIds: string[] }>(endpoints.resumeSession(sessionId), {
    method: "POST",
  });
}
