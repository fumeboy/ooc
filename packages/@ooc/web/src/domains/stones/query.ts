import { endpoints } from "../../transport/endpoints";
import { requestJson } from "../../transport/http";
import { HttpError } from "../../transport/errors";
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

export interface PutStoneFileInput {
  objectId: string;
  /** stone 相对路径，如 `self.md` / `executable/index.ts`（不含 `stones/<id>/` 前缀）。 */
  path: string;
  content: string;
  /** true 时带 `X-Overwrite-Confirm: true`，允许覆盖已有内容。 */
  confirmOverwrite?: boolean;
}

/**
 * A1：版本化写入一个 stone 源文件。
 *
 * 成功返回 `{ status: "ok", commitSha, merged }`；命中覆盖护栏（409
 * OVERWRITE_REQUIRES_CONFIRM）时**不抛**，而是返回 `{ status: "overwrite-required", message }`
 * 让 UI 弹确认后带 confirmOverwrite 重试。其余错误照常抛 HttpError。
 */
export async function putStoneFile({
  objectId,
  path,
  content,
  confirmOverwrite = false,
}: PutStoneFileInput): Promise<
  | { status: "ok"; commitSha?: string; merged?: boolean }
  | { status: "overwrite-required"; message: string }
> {
  try {
    const res = await requestJson<{ ok: boolean; commitSha?: string; merged?: boolean }>(
      endpoints.stoneFile(objectId),
      {
        method: "PUT",
        headers: confirmOverwrite ? { "X-Overwrite-Confirm": "true" } : undefined,
        body: JSON.stringify({ path, content }),
      },
    );
    return { status: "ok", commitSha: res.commitSha, merged: res.merged };
  } catch (error) {
    if (error instanceof HttpError && error.code === "OVERWRITE_REQUIRES_CONFIRM") {
      return { status: "overwrite-required", message: error.message };
    }
    throw error;
  }
}
