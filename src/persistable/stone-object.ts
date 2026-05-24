import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { stoneDir, toJson, type StoneObjectRef } from "./common";
import { selfFile } from "./stone-self";
import { readmeFile } from "./stone-readme";

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

/**
 * stone 的 knowledge 目录（seed knowledge；进 git review）。
 *
 * 与 pool 的 sediment knowledge 二分（参考 meta/object.doc.ts `persistable.stone.children.seed_knowledge`）：
 * - 这里是先天/设计层 seed：`stones/<branch>/objects/<self>/knowledge/<slug>.md`，由 Object 主动写入并经 git review
 * - pool 侧 sediment：`pools/objects/<self>/knowledge/memory|relations/...`，运行时积累，不进 git
 *
 * loader 双源扫描时统一加载、LLM 视角不分来源；同名冲突 sediment 胜出（详见 loader.ts loadKnowledgeIndex）。
 */
export function stoneKnowledgeDir(ref: StoneObjectRef): string {
  return join(stoneDir(ref), "knowledge");
}

/**
 * 创建 stone 的最小可见骨架：`.stone.json` + `self.md` + `readme.md`（**空文件占位**）。
 *
 * 创建的初始文件（2026-05-24 修订，visibility-first）:
 * - `.stone.json`：元数据
 * - `self.md`：**空文件**——`ls stoneDir` 可见；readSelf 返回 ""；
 *   `loadSelfInstructions` 视 empty 等价 undefined，故不会注入空 instructions。
 *   正文由 Object 后续主动 writeSelf 写入。
 * - `readme.md`：**空文件**——同上语义；正文由 Object 后续主动 writeReadme 写入。
 *
 * **不预创**的目录（按需 lazy 创建，避免 `ls` 看到一堆空目录引发"骨架不全"误判）:
 * - server/  ← 写第一个 server method 时由 stone-server.ts 自动 mkdir
 * - client/  ← 写第一个 client 入口时由 stone-client.ts 自动 mkdir
 * - knowledge/ ← seed knowledge 完全可选；首次 write_file 时 lazy mkdir
 *
 * **不再创建** files/（2026-05-23 起迁到 pool；详见 createPoolObject）。
 * **不再创建** database/（2026-05-24 起删除；csv 替代 sql；详见 persistable.pool.children.data_pool）。
 */
export async function createStoneObject(ref: StoneObjectRef): Promise<StoneObjectRef> {
  await mkdir(stoneDir(ref), { recursive: true });

  const metadata: StoneObjectMetadata = { type: "stone", objectId: ref.objectId };
  await writeFile(stoneMetadataFile(ref), toJson(metadata), "utf8");

  await writeFile(selfFile(ref), "", "utf8");
  await writeFile(readmeFile(ref), "", "utf8");

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
