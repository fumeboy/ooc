import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { objectDir, toJson, type FlowObjectRef } from "./common";
import type { ClassRegistry } from "../runtime/object-registry.js";
import { builtinClassRegistry } from "../runtime/object-registry.js";

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
   * 实例所属的 Class（也是一个 string id；必须在 object registry 注册过）。
   *
   * object 经 ooc.class 单跳继承一个 class——method 解析按「实例 self → 其单一 class」两层
   * （`object-registry.ts` 的 `resolveObjectMethod(s)`，无多级链、无 root 回退）；class 未声明
   * 的 facet 走框架内置缺省。
   *
   * 缺省（旧 .flow.json 没有该字段）→ 兼容读取，方法解析仍通过 self.class 直接走
   * registry，等价于 class === self.class。新写入路径在创建 flow object 时会显式带上 class。
   */
  class?: string;
}

/**
 * createFlowObject 接受到不存在的 class 时抛出此错误。
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

/**
 * 读取 flow object 的继承 class（`.flow.json:class`）。
 *
 * flow object 的 class 落 `.flow.json`（非 stone `package.json`）——HTTP 控制面 visible/server
 * dispatch 解析其继承链时据此找 class（如 builtin `_builtin/agent/todo`）。
 * 不存在 / 解析失败 / 无 class 字段 → undefined（dispatch 退化用 objectId 自身）。
 */
export async function readFlowObjectClass(ref: FlowObjectRef): Promise<string | undefined> {
  try {
    const raw = await readFile(flowMetadataFile(ref), "utf8");
    const meta = JSON.parse(raw) as FlowObjectMetadata;
    const cls = meta?.class;
    return typeof cls === "string" && cls.trim().length > 0 ? cls.trim() : undefined;
  } catch {
    return undefined;
  }
}

/** session 目录绝对路径。 */
export function sessionDir(baseDir: string, sessionId: string): string {
  return join(baseDir, "flows", sessionId);
}

/** session 元数据文件 `.session.json` 的绝对路径。 */
export function sessionMetadataFile(baseDir: string, sessionId: string): string {
  return join(sessionDir(baseDir, sessionId), ".session.json");
}

/**
 * 创建 flow session 根目录并写入 `.session.json`。
 *
 * business session 的 `flows/<sid>` 由调用方先经
 * `ensureSessionWorktree` eager 建成 git worktree（空目录要求），本函数的 `mkdir recursive`
 * 此时对已存在的 worktree 目录幂等 no-op，只补写 `.session.json`（运行时数据，被 .gitignore
 * 排除）。super / 无 worktree 的 session 走普通 mkdir。
 */
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
 * 接受可选 `opts.class`，若提供则写入 `.flow.json:class`。
 * 当 opts.class 指向 object registry 中未注册的 type 时抛 `ClassNotFoundError`
 * （fail-loud：避免 `.flow.json:class` 引到悬空 class，导致 method 解析时静默 miss）。
 *
 * 兼容性：单参调用仍合法（旧 caller 全部沿用），不会写 class 字段。
 */
export async function createFlowObject(
  ref: FlowObjectRef,
  opts?: { class?: string },
  registry: ClassRegistry = builtinClassRegistry,
): Promise<FlowObjectRef> {
  // class 存在性校验：未注册时 fail-loud（避免 .flow.json:class 引到悬空 class）。
  if (opts?.class !== undefined && !registry.hasClass(opts.class)) {
    throw new ClassNotFoundError(opts.class);
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
