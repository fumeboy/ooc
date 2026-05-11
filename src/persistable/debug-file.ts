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

/** loop 级 debug 元数据，帮助排查每轮上下文与耗时。 */
export interface LlmLoopDebugMetaRecord {
  /** 触发本次请求的线程 ID。 */
  threadId: string;
  /** 当前线程内的第几轮 LLM 调用。 */
  loopIndex: number;
  /** 实际调用的 provider。 */
  provider?: string;
  /** 实际调用的模型名。 */
  model?: string;
  /** 本轮开始时间（毫秒时间戳）。 */
  startedAt: number;
  /** 本轮结束时间（毫秒时间戳）。 */
  finishedAt: number;
  /** 本轮总耗时。 */
  latencyMs: number;
  /** messages 条目数。 */
  messageCount: number;
  /** 暴露给模型的 tool 数量。 */
  toolCount: number;
  /** 模型返回的 tool call 数量。 */
  toolCallCount: number;
  /** 输入 context 的字节数。 */
  contextBytes: number;
  /** result.text 的字节数。 */
  resultTextBytes: number;
  /** 本轮状态。 */
  status: "ok" | "paused" | "error";
  /** 本轮失败原因。 */
  error?: string;
}

/** debug 目录绝对路径，仅本文件内部使用。 */
function debugDir(ref: ThreadPersistenceRef): string {
  return join(threadDir(ref), "debug");
}

/** 把轮次编号格式化为稳定文件名。 */
function formatLoopIndex(loopIndex: number): string {
  return String(loopIndex).padStart(4, "0");
}

/** 单个线程的 LLM 输入 debug 文件绝对路径。 */
export function llmInputFile(ref: ThreadPersistenceRef): string {
  return join(debugDir(ref), "llm.input.json");
}

/** 单个线程的 LLM 输出 debug 文件绝对路径。 */
export function llmOutputFile(ref: ThreadPersistenceRef): string {
  return join(debugDir(ref), "llm.output.json");
}

/** 单轮 LLM 输入 debug 文件绝对路径。 */
export function loopInputFile(ref: ThreadPersistenceRef, loopIndex: number): string {
  return join(debugDir(ref), `loop_${formatLoopIndex(loopIndex)}.input.json`);
}

/** 单轮 LLM 输出 debug 文件绝对路径。 */
export function loopOutputFile(ref: ThreadPersistenceRef, loopIndex: number): string {
  return join(debugDir(ref), `loop_${formatLoopIndex(loopIndex)}.output.json`);
}

/** 单轮 LLM 元数据 debug 文件绝对路径。 */
export function loopMetaFile(ref: ThreadPersistenceRef, loopIndex: number): string {
  return join(debugDir(ref), `loop_${formatLoopIndex(loopIndex)}.meta.json`);
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

/** 写入单轮 LLM 输入快照。 */
export async function writeLoopDebugInput(
  ref: ThreadPersistenceRef,
  loopIndex: number,
  record: LlmInputDebugRecord
): Promise<void> {
  await mkdir(debugDir(ref), { recursive: true });
  await writeFile(loopInputFile(ref, loopIndex), toJson(record), "utf8");
}

/** 写入单轮 LLM 输出快照。 */
export async function writeLoopDebugOutput(
  ref: ThreadPersistenceRef,
  loopIndex: number,
  record: LlmOutputDebugRecord
): Promise<void> {
  await mkdir(debugDir(ref), { recursive: true });
  await writeFile(loopOutputFile(ref, loopIndex), toJson(record), "utf8");
}

/** 写入单轮 LLM 元数据。 */
export async function writeLoopDebugMeta(
  ref: ThreadPersistenceRef,
  loopIndex: number,
  record: LlmLoopDebugMetaRecord
): Promise<void> {
  await mkdir(debugDir(ref), { recursive: true });
  await writeFile(loopMetaFile(ref, loopIndex), toJson(record), "utf8");
}
