import { endpoints } from "../../transport/endpoints";
import { requestJson } from "../../transport/http";
import type { CreateStoneInput, KnowledgeEntryInput, Stone } from "./model";

export function fetchStones() {
  return requestJson<{ items: Stone[] }>(endpoints.stones);
}

export function createStone(input: CreateStoneInput) {
  return requestJson<{ objectId: string; dir: string; created: boolean }>(endpoints.stones, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function createKnowledgeDirectory({ objectId, path }: KnowledgeEntryInput) {
  return requestJson<{ objectId: string; path: string; created: boolean }>(endpoints.stoneKnowledgeDirectories(objectId), {
    method: "POST",
    body: JSON.stringify({ path }),
  });
}

export function createKnowledgeFile({ objectId, path, content = "" }: KnowledgeEntryInput) {
  return requestJson<{ objectId: string; path: string; created: boolean }>(endpoints.stoneKnowledgeFiles(objectId), {
    method: "POST",
    body: JSON.stringify({ path, content }),
  });
}

export function updateKnowledgeFile({ objectId, path, content = "" }: KnowledgeEntryInput) {
  return requestJson<{ objectId: string; path: string; ok: boolean }>(endpoints.stoneKnowledgeFiles(objectId), {
    method: "PUT",
    body: JSON.stringify({ path, content }),
  });
}
