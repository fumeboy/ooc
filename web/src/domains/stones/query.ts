import { endpoints } from "../../transport/endpoints";
import { requestJson } from "../../transport/http";
import type { CreateStoneInput, KnowledgeEntryInput, Stone } from "./model";

/** ooc-3 stones list shape */
type Ooc3StoneItem = { uri: string; name: string; title?: string; kind: string };

/**
 * Fetch stones list. Adapts ooc-3 shape { uri, name, title, kind } to ooc-2 { objectId, dir }.
 */
export async function fetchStones(): Promise<{ items: Stone[] }> {
  const res = await requestJson<{ ok: boolean; stones: Ooc3StoneItem[] }>(
    `${endpoints.stones}?branch=main`,
  );
  const items: Stone[] = (res.stones ?? []).map((s) => ({
    objectId: s.name,
    dir: `stones/main/objects/${s.name}`,
  }));
  return { items };
}

/**
 * Create stone — (Batch 4 backend addition).
 * Currently not implemented in ooc-3; throws a clear error.
 */
export async function createStone(_input: CreateStoneInput): Promise<void> {
  throw new Error("createStone not implemented in ooc-3 yet (Batch 4 backend)");
}

/**
 * Knowledge CRUD — (Batch 4 backend addition).
 * Not implemented in ooc-3 yet.
 */
export async function createKnowledgeDirectory(_input: KnowledgeEntryInput): Promise<void> {
  throw new Error("createKnowledgeDirectory not implemented in ooc-3 yet");
}

export async function createKnowledgeFile(_input: KnowledgeEntryInput): Promise<void> {
  throw new Error("createKnowledgeFile not implemented in ooc-3 yet");
}

export async function updateKnowledgeFile(_input: KnowledgeEntryInput & { content: string }): Promise<void> {
  throw new Error("updateKnowledgeFile not implemented in ooc-3 yet");
}
