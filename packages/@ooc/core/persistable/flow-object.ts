import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { objectDir, toJson, type FlowObjectRef } from "./common";
import { getObjectDefinition } from "../executable/windows/_shared/registry.js";

/** session 元数据，写入 `.session.json`。 */
export interface FlowSessionMetadata {
  /** 元数据判别字段。 */
  type: "flow-session";
  /** session id。 */
  sessionId: string;
  /** session 标题。 */
  title: string;
}

/** 写入 `.flow.json` 的元数据。 */
export interface FlowObjectMetadata {
  /** 元数据判别字段，用于和 `.stone.json` 等其他元数据区分。 */
  type: "flow-object";
  /** 与 ref 同步的 sessionId 副本，便于离线读取无需推断目录结构。 */
  sessionId: string;
  /** 与 ref 同步的 objectId 副本。 */
  objectId: string;
  /**
   * P6.§7 (2026-06-02): 实例所属的 Class（也是一个 ObjectType id；必须在 object registry 注册过）。
   *
   * Class 是方法继承链的载体——method 解析按「实例 self.type → class definition.methods →
   * parentClass.methods → … → root.methods」沿父类链向上回退。`registerObjectType` 与
   * `resolveMethod` 共同在 `_shared/registry.ts` 实装该机制。
   *
   * 缺省（旧 .flow.json 没有该字段）→ 兼容读取，方法解析仍通过 self.type 直接走
   * registry，等价于 class === self.type。新写入路径在创建 flow object 时会显式带上 class。
   */
  class?: string;
}

/**
 * P6.§7 (2026-06-02): createFlowObject 接受到不存在的 class 时抛出此错误。
 *
 * `code === "CLASS_NOT_FOUND"` 用于服务层 / migration 工具识别此具体错误，区别于其他
 * 文件系统失败。`classId` 字段携带未注册的 class 名，便于错误日志直接显示。
 */
export class ClassNotFoundError extends Error {
  readonly code = "CLASS_NOT_FOUND";
  readonly classId: string;
  constructor(classId: string) {
    super(`createFlowObject: class "${classId}" is not registered in object registry`);
    this.name = "ClassNotFoundError";
    this.classId = classId;
  }
}

/** flow object 元数据文件 `.flow.json` 的绝对路径。 */
export function flowMetadataFile(ref: FlowObjectRef): string {
  return join(objectDir(ref), ".flow.json");
}

/** session 目录绝对路径。 */
export function sessionDir(baseDir: string, sessionId: string): string {
  return join(baseDir, "flows", sessionId);
}

/** session 元数据文件 `.session.json` 的绝对路径。 */
export function sessionMetadataFile(baseDir: string, sessionId: string): string {
  return join(sessionDir(baseDir, sessionId), ".session.json");
}

/** 创建 flow session 根目录并写入 `.session.json`。 */
export async function createFlowSession(baseDir: string, sessionId: string, title?: string): Promise<void> {
  await mkdir(sessionDir(baseDir, sessionId), { recursive: true });
  const metadata: FlowSessionMetadata = {
    type: "flow-session",
    sessionId,
    title: title ?? sessionId,
  };
  await writeFile(sessionMetadataFile(baseDir, sessionId), toJson(metadata), "utf8");
}

/** 创建 flow object 目录结构并写入 `.flow.json` 元数据。
 *
 * P6.§7 (2026-06-02): 接受可选 `opts.class`，若提供则写入 `.flow.json:class`。
 * 当 opts.class 指向 object registry 中未注册的 type 时抛 `ClassNotFoundError`
 * （fail-loud：避免 `.flow.json:class` 引到悬空 class，导致 method 解析时静默 miss）。
 *
 * 兼容性：单参调用仍合法（旧 caller 全部沿用），不会写 class 字段。
 */
export async function createFlowObject(
  ref: FlowObjectRef,
  opts?: { class?: string },
): Promise<FlowObjectRef> {
  // class 存在性校验：未注册时 fail-loud。注意 try/catch — getObjectDefinition 未注册时抛错。
  if (opts?.class !== undefined) {
    let registered = false;
    try {
      getObjectDefinition(opts.class as never);
      registered = true;
    } catch {
      registered = false;
    }
    if (!registered) {
      throw new ClassNotFoundError(opts.class);
    }
  }

  await mkdir(objectDir(ref), { recursive: true });

  const metadata: FlowObjectMetadata = {
    type: "flow-object",
    sessionId: ref.sessionId,
    objectId: ref.objectId,
    ...(opts?.class !== undefined ? { class: opts.class } : {}),
  };
  await writeFile(flowMetadataFile(ref), toJson(metadata), "utf8");
  return ref;
}
