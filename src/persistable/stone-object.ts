import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { stoneDir, toJson, type StoneObjectRef } from "./common";

export { stoneDir };

/** 写入 `.stone.json` 的元数据。 */
export interface StoneObjectMetadata {
  /** 元数据判别字段，区分 .stone.json 与 .flow.json / .pool.json。 */
  type: "stone";
  /** 与 ref 同步的 objectId 副本，便于离线读取无需推断目录结构。 */
  objectId: string;
}

/** stone 元数据文件 `.stone.json` 的绝对路径。 */
export function stoneMetadataFile(ref: StoneObjectRef): string {
  return join(stoneDir(ref), ".stone.json");
}

/** stone 的 server 目录。 */
export function serverDir(ref: StoneObjectRef): string {
  return join(stoneDir(ref), "server");
}

/** stone 的 client 目录。 */
export function clientDir(ref: StoneObjectRef): string {
  return join(stoneDir(ref), "client");
}

/** stone 的 database 顶层目录（pool/sql 的 schema 设计层；2026-05-23 引入）。 */
export function stoneDatabaseDir(ref: StoneObjectRef): string {
  return join(stoneDir(ref), "database");
}

/** stone 的 database/schemas 目录（TS 类型定义；被 server method 用作返回值/参数类型）。 */
export function stoneDatabaseSchemasDir(ref: StoneObjectRef): string {
  return join(stoneDatabaseDir(ref), "schemas");
}

/** stone 的 database/migrations 目录（forward-only SQL；migration runner 启动时按序 apply）。 */
export function stoneDatabaseMigrationsDir(ref: StoneObjectRef): string {
  return join(stoneDatabaseDir(ref), "migrations");
}

/**
 * 创建 stone 目录骨架（缩水到设计五件套；2026-05-23 起）+ 写入 `.stone.json`。
 *
 * 创建的子树:
 * - server/                  ← stone server 源码
 * - client/                  ← stone client 源码
 * - database/schemas/        ← TS 类型
 * - database/migrations/     ← forward-only SQL
 *
 * 不写 self.md / readme.md / server/index.ts —— 这些由 Object 后续主动写入。
 *
 * **不再创建** knowledge/ 与 files/（2026-05-23 起迁到 pool；详见 createPoolObject）。
 */
export async function createStoneObject(ref: StoneObjectRef): Promise<StoneObjectRef> {
  await mkdir(serverDir(ref), { recursive: true });
  await mkdir(clientDir(ref), { recursive: true });
  await mkdir(stoneDatabaseSchemasDir(ref), { recursive: true });
  await mkdir(stoneDatabaseMigrationsDir(ref), { recursive: true });

  const metadata: StoneObjectMetadata = { type: "stone", objectId: ref.objectId };
  await writeFile(stoneMetadataFile(ref), toJson(metadata), "utf8");
  return ref;
}

// 已迁出的函数（2026-05-23 三分重组）：
// - knowledgeDir / memoryDir / relationsDir / relationFile / readRelation
//   → src/persistable/pool-object.ts 的 poolKnowledgeDir / poolKnowledgeMemoryDir /
//     poolKnowledgeRelationsDir / poolKnowledgeRelationFile / readPoolRelation
// - filesDir
//   → src/persistable/pool-object.ts 的 poolFilesDir
// - dataFile / readData / writeData / mergeData (旧 stone-data.ts，已删除)
//   → 语义改为 session-scoped；详见 src/persistable/flow-data.ts
//
// 保留 readFile import 以备未来 stone 内其它"内容文件"读取需要；目前未直接使用。
void readFile;
