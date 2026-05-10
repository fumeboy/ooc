import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { objectDir, toJson, type FlowObjectRef } from "./common";

/** 写入 `.flow.json` 的元数据。 */
export interface FlowObjectMetadata {
  /** 元数据判别字段，用于和 `.stone.json` 等其他元数据区分。 */
  type: "flow-object";
  /** 与 ref 同步的 sessionId 副本，便于离线读取无需推断目录结构。 */
  sessionId: string;
  /** 与 ref 同步的 objectId 副本。 */
  objectId: string;
}

/** flow object 元数据文件 `.flow.json` 的绝对路径。 */
export function flowMetadataFile(ref: FlowObjectRef): string {
  return join(objectDir(ref), ".flow.json");
}

/** 创建 flow object 目录结构并写入 `.flow.json` 元数据。 */
export async function createFlowObject(ref: FlowObjectRef): Promise<FlowObjectRef> {
  await mkdir(objectDir(ref), { recursive: true });

  const metadata: FlowObjectMetadata = {
    type: "flow-object",
    sessionId: ref.sessionId,
    objectId: ref.objectId
  };
  await writeFile(flowMetadataFile(ref), toJson(metadata), "utf8");
  return ref;
}
