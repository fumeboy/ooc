import type { FlowSession } from "./model";

export function flowTitle(flow: FlowSession) {
  return flow.title || flow.sessionId;
}

