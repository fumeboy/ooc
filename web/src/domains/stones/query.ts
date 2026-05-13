import { endpoints } from "../../transport/endpoints";
import { requestJson } from "../../transport/http";
import type { Stone } from "./model";

export function fetchStones() {
  return requestJson<{ items: Stone[] }>(endpoints.stones);
}

