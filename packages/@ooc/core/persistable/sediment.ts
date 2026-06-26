/**
 * sediment —— pool 沉淀（flow → pool promote）（issue D 落地裁决 4）。
 *
 * 既有 `sedimentKnowledge`（reflectable.ts 内）保留——pool 知识/记忆专用 API；
 * 本文件新增 **_promoteFlowUnversionedToPool**（私有 API）：把 flow data.json 内非版本化字段
 * 写入 `pools/objects/<id>/data.json`（merge）。**仅供 thread executable
 * `sediment_unversioned` method 调用**——不对 LLM 暴露公开 pool 直写 API（issue D 裁决 4：
 * "退役 writePoolUnversioned"，仅 super session 内 sediment_unversioned 才把 flow→pool promote）。
 *
 * promote 完成后**不**改 flow data.json（让下次 scan_changes 仍能看到字段，由 caller
 * 自行决定是否再次 sediment；本 issue 不实现 sediment marker 记账，留 followup）。
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { nestedObjectPath, toJson } from "./common.js";

/** pool data.json 物理路径。 */
function poolDataFile(baseDir: string, objectId: string): string {
  const segs = nestedObjectPath(objectId);
  return join(baseDir, "pools", "objects", ...segs, "data.json");
}

/** 读 pool data.json；不存在返回 {}. */
async function readPoolData(baseDir: string, objectId: string): Promise<Record<string, unknown>> {
  try {
    const raw = await readFile(poolDataFile(baseDir, objectId), "utf8");
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/**
 * **私有 API**：把 flow data.json 内指定 unversioned 字段 promote 到 pool data.json（merge）。
 *
 * 仅由 thread executable `sediment_unversioned` method 调用。
 *
 * @param baseDir   OOC world 根
 * @param objectId  被 promote 字段所属 object
 * @param fields    要 promote 的字段名 → 字段值（JSON 兼容）map
 */
export async function _promoteFlowUnversionedToPool(
  baseDir: string,
  objectId: string,
  fields: Record<string, unknown>,
): Promise<void> {
  if (Object.keys(fields).length === 0) return;
  const existing = await readPoolData(baseDir, objectId);
  const merged: Record<string, unknown> = { ...existing };
  for (const [field, value] of Object.entries(fields)) {
    merged[field] = value;
  }
  const file = poolDataFile(baseDir, objectId);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, toJson(merged), "utf8");
}
