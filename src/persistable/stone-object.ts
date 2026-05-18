import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { stoneDir, toJson, type StoneObjectRef } from "./common";

export { stoneDir };

/** 写入 `.stone.json` 的元数据。 */
export interface StoneObjectMetadata {
  /** 元数据判别字段，区分 .stone.json 与 .flow.json。 */
  type: "stone";
  /** 与 ref 同步的 objectId 副本，便于离线读取无需推断目录结构。 */
  objectId: string;
}

/** stone 元数据文件 `.stone.json` 的绝对路径。 */
export function stoneMetadataFile(ref: StoneObjectRef): string {
  return join(stoneDir(ref), ".stone.json");
}

/** stone 的 knowledge 顶层目录。 */
export function knowledgeDir(ref: StoneObjectRef): string {
  return join(stoneDir(ref), "knowledge");
}

/** stone 的 knowledge/memory 目录。 */
export function memoryDir(ref: StoneObjectRef): string {
  return join(knowledgeDir(ref), "memory");
}

/** stone 的 knowledge/relations 目录。 */
export function relationsDir(ref: StoneObjectRef): string {
  return join(knowledgeDir(ref), "relations");
}

/** stone 对某 peer 的 relation 文件 `knowledge/relations/{peerId}.md` 的绝对路径。 */
export function relationFile(ref: StoneObjectRef, peerId: string): string {
  return join(relationsDir(ref), `${peerId}.md`);
}

/**
 * 读取 stone 对某 peer 的 relation 文件,不存在(ENOENT)返回 undefined。
 *
 * 与 readReadme 同风格;caller 信任 peerId 合法性(目前来源是 talk_window.target,
 * 由 root.talk 在 open 时已做存在校验)。其它 IO 错误向上抛。
 */
export async function readRelation(
  ref: StoneObjectRef,
  peerId: string,
): Promise<string | undefined> {
  try {
    return await readFile(relationFile(ref, peerId), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

/** stone 的 server 目录。 */
export function serverDir(ref: StoneObjectRef): string {
  return join(stoneDir(ref), "server");
}

/** stone 的 client 目录。 */
export function clientDir(ref: StoneObjectRef): string {
  return join(stoneDir(ref), "client");
}

/** stone 的 files 目录（用户文件留存位）。 */
export function filesDir(ref: StoneObjectRef): string {
  return join(stoneDir(ref), "files");
}

/**
 * 创建 stone 目录全套骨架（按文档 stone 持久化结构）+ 写入 `.stone.json`。
 * 不写 self.md / readme.md / data.json / server/index.ts —— 这些由后续主动写入。
 */
export async function createStoneObject(ref: StoneObjectRef): Promise<StoneObjectRef> {
  await mkdir(memoryDir(ref), { recursive: true });
  await mkdir(relationsDir(ref), { recursive: true });
  await mkdir(serverDir(ref), { recursive: true });
  await mkdir(clientDir(ref), { recursive: true });
  await mkdir(filesDir(ref), { recursive: true });

  const metadata: StoneObjectMetadata = { type: "stone", objectId: ref.objectId };
  await writeFile(stoneMetadataFile(ref), toJson(metadata), "utf8");
  return ref;
}
