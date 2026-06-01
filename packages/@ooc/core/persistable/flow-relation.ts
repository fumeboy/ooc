/**
 * Flow-layer relation IO — 与 stone-object.ts 的 `relationFile / readRelation /
 * writeRelation` 形态对称,只是落点改为 flow object 目录下:
 *   `flows/<sessionId>/<objectId>/knowledge/relations/<peerId>.md`
 *
 * 设计:relation_window.edit(scope="session") 把"仅本 session 生效"的 relation
 * 写入这里;scope="long_term" 仍需经 super flow 写到 stones/。详见 plan
 * `docs/plans/2026-05-20-relation-window.md` (或 plan 草案 witty-bubbling-pebble.md)
 * 与 meta/object collaborable.relation_window 节点。
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { objectDir, type FlowObjectRef } from "./common";

/** flow object 下的 `knowledge/relations` 目录。 */
export function flowRelationsDir(ref: FlowObjectRef): string {
  return join(objectDir(ref), "knowledge", "relations");
}

/** flow object 对某 peer 的 relation 文件 `knowledge/relations/{peerId}.md` 的绝对路径。 */
export function flowRelationFile(ref: FlowObjectRef, peerId: string): string {
  return join(flowRelationsDir(ref), `${peerId}.md`);
}

/**
 * 读取 flow object 对某 peer 的 relation 文件,不存在(ENOENT)返回 undefined。
 * 其它 IO 错误向上抛。
 */
export async function readFlowRelation(
  ref: FlowObjectRef,
  peerId: string,
): Promise<string | undefined> {
  try {
    return await readFile(flowRelationFile(ref, peerId), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

/**
 * 写入 flow object 对某 peer 的 relation 文件;自动 mkdir -p 父目录。整文件替换语义,
 * 不做 merge / append。
 */
export async function writeFlowRelation(
  ref: FlowObjectRef,
  peerId: string,
  content: string,
): Promise<void> {
  const file = flowRelationFile(ref, peerId);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, content, "utf8");
}
