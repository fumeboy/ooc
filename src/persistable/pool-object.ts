/**
 * Pool 持久层 —— Object 跨 session 累积的事实数据（sql / knowledge / files 三件套）。
 *
 * 与 stone（设计层 + git）/ flow（运行层 + ephemeral）三分。pool 持久但不进 git。
 *
 * 路径形态（不挂 branch；详见 meta/object.doc.ts persistable.pool.no_branch patch）:
 *
 *   {baseDir}/pools/objects/{objectId}/
 *     .pool.json
 *     sql/data.sqlite           ← bun:sqlite 主文件（runtime 待落地）
 *     knowledge/memory/<slug>.md
 *     knowledge/relations/<peer>.md
 *     files/...
 *
 * 本文件只负责路径计算与目录骨架创建；bun:sqlite 连接 / migration runner 待
 * follow-up（详见 meta/object.doc.ts persistable.pool.todo）。
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { toJson, type ThreadPersistenceRef } from "./common";

/**
 * 标识磁盘上的单个 pool object 目录。
 *
 * 与 StoneObjectRef 形状相同（都是 `{ baseDir, objectId }`），但语义不同：
 * - StoneObjectRef 定位 stones/{branch}/objects/{id}/（设计层）。
 * - PoolObjectRef 定位 pools/objects/{id}/（事实层；不挂 branch）。
 *
 * 用类型区分而非字段区分，避免误用。
 */
export interface PoolObjectRef {
  /** 包含 `pools/` 的根目录。 */
  baseDir: string;
  /** `pools/objects/` 下的 object 目录名。 */
  objectId: string;
}

/** 写入 `.pool.json` 的元数据。 */
export interface PoolObjectMetadata {
  /** 元数据判别字段，区分 .pool.json 与 .stone.json / .flow.json。 */
  type: "pool";
  /** 与 ref 同步的 objectId 副本，便于离线读取无需推断目录结构。 */
  objectId: string;
}

/** pool/objects 中间层子目录名。 */
export const POOL_OBJECTS_SUBDIR = "objects";

/** 计算 pool 目录绝对路径。pool 不挂 branch（与 stones 不同）。 */
export function poolDir(ref: PoolObjectRef): string {
  return join(ref.baseDir, "pools", POOL_OBJECTS_SUBDIR, ref.objectId);
}

/** pool 元数据文件 `.pool.json` 的绝对路径。 */
export function poolMetadataFile(ref: PoolObjectRef): string {
  return join(poolDir(ref), ".pool.json");
}

/** pool 的 sql 顶层目录（bun:sqlite 主文件 + WAL）。 */
export function poolSqlDir(ref: PoolObjectRef): string {
  return join(poolDir(ref), "sql");
}

/** pool 的 knowledge 顶层目录。 */
export function poolKnowledgeDir(ref: PoolObjectRef): string {
  return join(poolDir(ref), "knowledge");
}

/** pool 的 knowledge/memory 目录（reflectable 长期记忆写入位置）。 */
export function poolKnowledgeMemoryDir(ref: PoolObjectRef): string {
  return join(poolKnowledgeDir(ref), "memory");
}

/** pool 的 knowledge/relations 目录（与 collaborable.relation_window 联动）。 */
export function poolKnowledgeRelationsDir(ref: PoolObjectRef): string {
  return join(poolKnowledgeDir(ref), "relations");
}

/** pool 对某 peer 的 relation 文件 `knowledge/relations/{peerId}.md` 的绝对路径。 */
export function poolKnowledgeRelationFile(ref: PoolObjectRef, peerId: string): string {
  return join(poolKnowledgeRelationsDir(ref), `${peerId}.md`);
}

/** pool 的 files 顶层目录（任意文件留存位）。 */
export function poolFilesDir(ref: PoolObjectRef): string {
  return join(poolDir(ref), "files");
}

/**
 * 读取 pool 对某 peer 的 relation 文件，不存在（ENOENT）返回 undefined。
 *
 * 与 stone-object 时代的 readRelation 同形态，只是基底改为 pool（2026-05-23 起 knowledge
 * 从 stone 迁出到 pool）。其它 IO 错误向上抛。
 */
export async function readPoolRelation(
  ref: PoolObjectRef,
  peerId: string,
): Promise<string | undefined> {
  try {
    return await readFile(poolKnowledgeRelationFile(ref, peerId), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

/**
 * 创建 pool 目录骨架 + 写入 `.pool.json`。
 *
 * 创建的子树:
 * - sql/                         ← 数据文件由 sql runtime 在首次连接时落地
 * - knowledge/memory/
 * - knowledge/relations/
 * - files/
 *
 * 不预创建任何 .md / .sqlite —— 这些由 runtime / Object 后续按需写入。
 */
export async function createPoolObject(ref: PoolObjectRef): Promise<PoolObjectRef> {
  await mkdir(poolSqlDir(ref), { recursive: true });
  await mkdir(poolKnowledgeMemoryDir(ref), { recursive: true });
  await mkdir(poolKnowledgeRelationsDir(ref), { recursive: true });
  await mkdir(poolFilesDir(ref), { recursive: true });

  const metadata: PoolObjectMetadata = { type: "pool", objectId: ref.objectId };
  await writeFile(poolMetadataFile(ref), toJson(metadata), "utf8");
  return ref;
}

/**
 * 从 ThreadPersistenceRef 派生 PoolObjectRef，让 server method / 反思场景从 thread
 * 切到 pool 视角访问数据。pool 不挂 branch，所以不传 stonesBranch。
 */
export function derivePoolFromThread(threadRef: ThreadPersistenceRef): PoolObjectRef {
  return {
    baseDir: threadRef.baseDir,
    objectId: threadRef.objectId,
  };
}
