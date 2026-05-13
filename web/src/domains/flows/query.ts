import { endpoints } from "../../transport/endpoints";
import { requestJson } from "../../transport/http";
import type { FlowSession } from "./model";

export function fetchFlows() {
  return requestJson<{ items: FlowSession[] }>(endpoints.flows);
}

