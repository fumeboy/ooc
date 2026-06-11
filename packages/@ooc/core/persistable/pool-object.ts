/**
 * Pool 持久层 —— Object 跨 session 累积的事实数据（data / knowledge / files 三件套）。
 *
 * 与 stone（设计层 + git）/ flow（运行层 + ephemeral）三分。pool 持久但不进 git。
 *
 * 路径形态（不挂 branch）:
 *
 *   {baseDir}/pools/objects/{objectId}/
 *     .pool.json
 *     data/<name>.csv                  ← csv-based 表数据（详见 ./csv-pool.ts）
 *     knowledge/memory/<slug>.md
 *     knowledge/relations/<peer>.md
 *     files/...
 *
 * 本文件负责路径计算与目录骨架创建；data 子层的读写在 ./csv-pool.ts。
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { nestedObjectPath, toJson, type ThreadPersistenceRef } from "./common";

/**
 * 标识磁盘上的单个 pool object 目录。
 *
 * 与 StoneObjectRef 形状相同（都是 `{ baseDir, objectId }`），但语义不同：
 * - StoneObjectRef 定位 packages/{nestedPath(id)}/（设计层）。
 * - PoolObjectRef 定位 pools/{nestedPath(id)}/（事实层）。
 *
 * 用类型区分而非字段区分，避免误用。
 */
export interface PoolObjectRef {
  /** 包含 `pools/` 的根目录。 */
  baseDir: string;
  /** pools/ 下的 object 目录名（逻辑 id；嵌套 segment 由 children/ 物理隔开）。 */
  objectId: string;
}

/** 写入 `.pool.json` 的元数据。 */
export interface PoolObjectMetadata {
  /** 元数据判别字段，区分 .pool.json 与 .stone.json / .flow.json。 */
  type: "pool";
  /** 与 ref 同步的 objectId 副本，便于离线读取无需推断目录结构。 */
  objectId: string;
}

/** @deprecated pools 不再有 `objects/` 中间层；路径与 stone/flow 对齐使用 children/ 嵌套。 */
export const POOL_OBJECTS_SUBDIR = "objects";

/**
 * 计算 pool 目录绝对路径。
 *
 * objectId 中的 "/" 被翻译为 children/ 嵌套，与 stone/flow 路径形态对齐：
 *   objectId="a/b/c" → pools/a/children/b/children/c/
 */
export function poolDir(ref: PoolObjectRef): string {
  return join(ref.baseDir, "pools", ...nestedObjectPath(ref.objectId));
}

/** pool 元数据文件 `.pool.json` 的绝对路径。 */
export function poolMetadataFile(ref: PoolObjectRef): string {
  return join(poolDir(ref), ".pool.json");
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
 * pool 的 data 顶层目录（csv-based 表数据；一张表 = 一个 csv 文件）。
 *
 * 详见 ./csv-pool.ts。
 */
export function poolDataDir(ref: PoolObjectRef): string {
  return join(poolDir(ref), "data");
}

/**
 * 校验 csv 表名：kebab-case，首字符小写字母，仅允许 [a-z0-9-]，最多 64 字符。
 *
 * 严格校验是为了防 path-traversal（与 stone-versioning 中 sessionId 校验同动机）；
 * 同时强制 kebab-case 命名习惯，避免 data/ 目录散落各种风格的文件名。
 */
const CSV_NAME_RE = /^[a-z][a-z0-9-]{0,63}$/;

/**
 * pool 的某张 csv 表文件路径 `data/<name>.csv`。
 *
 * name 必须匹配 kebab-case 约束（详见 CSV_NAME_RE 注释），否则抛错——
 * 这层校验保护下游 fs API 不被恶意路径串入侵。
 */
export function poolDataFile(ref: PoolObjectRef, name: string): string {
  if (!CSV_NAME_RE.test(name)) {
    throw new Error(`Invalid csv name: ${name}`);
  }
  return join(poolDataDir(ref), `${name}.csv`);
}

/**
 * 读取 pool 对某 peer 的 relation 文件，不存在（ENOENT）返回 undefined。
 *
 * 与 stone-object 时代的 readRelation 同形态，只是基底改为 pool（knowledge
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
 * - data/
 * - knowledge/memory/
 * - knowledge/relations/
 * - files/
 *
 * 不预创建任何 .md / .csv —— 这些由 runtime / Object 后续按需写入。
 * data/ 预创为空目录，与 knowledge/relations 等子目录预创风格保持一致：
 * Object 创建后立刻 `ls` 看见的目录骨架反映 pool 的三件套全貌（data/knowledge/files），
 * 而不是按需懒创——后者会让"pool 有几种子能力"这个事实变得隐式。
 */
export async function createPoolObject(ref: PoolObjectRef): Promise<PoolObjectRef> {
  await mkdir(poolDataDir(ref), { recursive: true });
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
