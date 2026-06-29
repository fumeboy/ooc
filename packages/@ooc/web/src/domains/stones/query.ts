import { TODO_async } from "../../transport/todo";
import type { CreateStoneInput, KnowledgeEntryInput, Stone } from "./model";

/**
 * 列出 world 内所有 stone object(stones/main/objects/<id>/)。
 *
 * 返回 Stone[]:每条含 objectId / kind(class|object) / 简要 metadata。
 */
export function fetchStones() {
  return TODO_async<{ items: Stone[] }>(
    `列出 world 内所有 stone object(stones/main/objects/<id>/); 每条 Stone { objectId, kind(class|object), 概要 metadata }; Sidebar Stones 浏览用`,
  );
}

/**
 * 创建一个新 stone object(走 versioning 经 worktree 提交 main)。
 *
 * input: { objectId, kind, baseClass? }; 后端创建 stones/main/objects/<id>/ + 落 self.md
 * + commit。返回 created=false 表示已存在(idempotent)。
 */
export function createStone(input: CreateStoneInput) {
  return TODO_async<{ objectId: string; dir: string; created: boolean }>(
    `创建 stone object: ${JSON.stringify(input)}; 经 versioning(worktree commit main); 落 stones/main/objects/<id>/ 骨架(self.md + package.json + readable/executable/visible/persistable 五件套); idempotent(已存在 returns created=false)`,
  );
}

/**
 * 创建 pool knowledge 目录(pools/<objectId>/knowledge/<path>/)。
 *
 * 注:虽 endpoint 名带 stone,实际写入 pool 层(非版本化 sediment)。
 */
export function createKnowledgeDirectory({ objectId, path }: KnowledgeEntryInput) {
  return TODO_async<{ objectId: string; path: string; created: boolean }>(
    `创建 pool knowledge 目录: pools/${objectId}/knowledge/${path}/; pool 层 sediment 非版本化; 不 commit`,
  );
}

/**
 * 创建 pool knowledge 文件(pools/<objectId>/knowledge/<path>)。
 */
export function createKnowledgeFile({ objectId, path, content = "" }: KnowledgeEntryInput) {
  return TODO_async<{ objectId: string; path: string; created: boolean }>(
    `创建 pool knowledge 文件: pools/${objectId}/knowledge/${path}, content=<${content.length} chars>; pool 层 sediment; idempotent`,
  );
}

/**
 * 覆盖更新 pool knowledge 文件内容。
 */
export function updateKnowledgeFile({ objectId, path, content = "" }: KnowledgeEntryInput) {
  return TODO_async<{ objectId: string; path: string; ok: boolean }>(
    `更新 pool knowledge 文件: pools/${objectId}/knowledge/${path}, content=<${content.length} chars>; 覆盖写入 sediment 层; 不 commit`,
  );
}
