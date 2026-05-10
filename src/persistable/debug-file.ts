import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { threadDir, toJson, type ThreadPersistenceRef } from "./common";
import type { LlmGenerateResult, LlmMessage, LlmTool } from "../thinkable/llm/types";

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

/** debug 目录绝对路径，仅本文件内部使用。 */
function debugDir(ref: ThreadPersistenceRef): string {
  return join(threadDir(ref), "debug");
}

/** 单个线程的 LLM 输入 debug 文件绝对路径。 */
export function llmInputFile(ref: ThreadPersistenceRef): string {
  return join(debugDir(ref), "llm.input.json");
}

/** 单个线程的 LLM 输出 debug 文件绝对路径。 */
export function llmOutputFile(ref: ThreadPersistenceRef): string {
  return join(debugDir(ref), "llm.output.json");
}

/** 写入最近一次 LLM 输入快照，覆盖旧文件。 */
export async function writeDebugInput(
  ref: ThreadPersistenceRef,
  record: LlmInputDebugRecord
): Promise<void> {
  await mkdir(debugDir(ref), { recursive: true });
  await writeFile(llmInputFile(ref), toJson(record), "utf8");
}

/** 写入最近一次 LLM 输出快照，覆盖旧文件。 */
export async function writeDebugOutput(
  ref: ThreadPersistenceRef,
  record: LlmOutputDebugRecord
): Promise<void> {
  await mkdir(debugDir(ref), { recursive: true });
  await writeFile(llmOutputFile(ref), toJson(record), "utf8");
}
