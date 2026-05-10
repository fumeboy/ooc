import type { LlmGenerateResult, LlmMessage, LlmTool } from "../thinkable/llm/types";

/** 标识磁盘上的单个 flow object 目录。 */
export interface FlowObjectRef {
  /** 包含 `flows/` 的根目录。 */
  baseDir: string;
  /** `flows/` 下的 session 目录名。 */
  sessionId: string;
  /** `flows/{sessionId}/objects/` 下的 object 目录名。 */
  objectId: string;
}

/** 标识 flow object 内的单个线程持久化位置。 */
export interface ThreadPersistenceRef extends FlowObjectRef {
  /** `threads/` 下的线程目录名。 */
  threadId: string;
}

/** 写入 `.flow.json` 的元数据。 */
export interface FlowObjectMetadata {
  /** 元数据判别字段，用于和 `.stone.json` 等其他元数据区分。 */
  type: "flow-object";
  /** 与 ref 同步的 sessionId 副本，便于离线读取无需推断目录结构。 */
  sessionId: string;
  /** 与 ref 同步的 objectId 副本。 */
  objectId: string;
}

/** 调用 LLM 前写入的输入快照。 */
export interface LlmInputDebugRecord {
  /** 触发本次请求的线程 ID。 */
  threadId: string;
  /** 传给 provider 的完整 messages。 */
  messages: LlmMessage[];
  /** 本轮暴露给 provider 的 tool 定义。 */
  tools: LlmTool[];
}

/** LLM 返回后写入的输出快照。 */
export interface LlmOutputDebugRecord {
  /** 触发本次请求的线程 ID。 */
  threadId: string;
  /** 归一化后的 provider 结果。 */
  result: LlmGenerateResult;
}
