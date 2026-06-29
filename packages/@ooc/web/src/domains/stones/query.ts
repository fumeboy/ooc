import { TODO_async } from "../../transport/todo";
import { requestJson } from "../../transport/http";
import { endpoints } from "../../transport/endpoints";
import type { CreateStoneInput, KnowledgeEntryInput, Stone } from "./model";

/**
 * 列出 world 内所有 stone object(stones/main/objects/<id>/)。
 *
 * S3 (2026-06-29) 解桩 — 走 GET /api/stones。
 */
export function fetchStones() {
  return requestJson<{ items: Stone[] }>(endpoints.stones);
}

/**
 * 创建一个新 stone object(走 versioning 经 worktree 提交 main)。
 *
 * S3 (2026-06-29) 解桩 — 走 POST /api/stones; idempotent (已存在 returns created=false)。
 */
export function createStone(input: CreateStoneInput) {
  return requestJson<{ objectId: string; dir: string; created: boolean }>(endpoints.stones, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/**
 * 创建 pool knowledge 目录 — pool 层 sediment 非版本化。
 * pool endpoints (/api/pools/<id>/knowledge/{directories,files}) 当前 server 未实现,
 * 留 follow-up issue。
 */
export function createKnowledgeDirectory({ objectId, path }: KnowledgeEntryInput) {
  return TODO_async<{ objectId: string; path: string; created: boolean }>(
    `[follow-up] pool knowledge endpoints 待实现 (/api/pools/${objectId}/knowledge/directories);S3 仅实现 stones list+create,pool sediment 留独立 issue`,
  );
}

/**
 * 创建 pool knowledge 文件 — 同上待实现。
 */
export function createKnowledgeFile({ objectId, path, content = "" }: KnowledgeEntryInput) {
  return TODO_async<{ objectId: string; path: string; created: boolean }>(
    `[follow-up] pool knowledge file 待实现 (/api/pools/${objectId}/knowledge/files), content=<${content.length} chars>`,
  );
}

/**
 * 覆盖更新 pool knowledge 文件内容 — 同上待实现。
 */
export function updateKnowledgeFile({ objectId, path, content = "" }: KnowledgeEntryInput) {
  return TODO_async<{ objectId: string; path: string; ok: boolean }>(
    `[follow-up] pool knowledge update 待实现 (PUT /api/pools/${objectId}/knowledge/files), content=<${content.length} chars>`,
  );
}
