import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { threadDir, toJson, type ThreadPersistenceRef } from "./common";
import type { LlmGenerateResult, LlmInputItem, LlmMessage } from "../thinkable/llm/types";

/**
 * 调用 LLM 前同时落盘的 thread context 快照（P2 slim 版）。
 *
 * P2 注意：Window 概念已按 spec V2 §6.1 塌掉；contextWindows 字段改为
 * `unknown[]`，ooc-3 等价字段（ObjectRecord slots 等）在 P4+ 阶段补设计。
 */
export interface ContextSnapshot {
  id: string;
  status?: string;
  /**
   * @deprecated 2026-05-26 起 thread.plan 字段已废弃。
   * 字段保留以兼容历史 llm.input.json，新写入永远是 undefined。
   */
  plan?: string;
  /** P2 slim: 原 contextWindows 塌缩为 unknown[]; P4+ 替换为 ObjectRecord slots。 */
  contextWindows: unknown[];
  inbox?: unknown[];
  outbox?: unknown[];
  events?: unknown[];
  creatorThreadId?: string;
  parentThreadId?: string;
}

/** 调用 LLM 前写入的输入快照。 */
export interface LlmInputDebugRecord {
  /** 触发本次请求的线程 ID。 */
  threadId: string;
  /** 传给 provider 的完整 input items。 */
  inputItems: LlmInputItem[];
  /**
   * 与 inputItems 中 system message XML 同源的结构化 thread 状态快照；
   * 前端 UI 可不解析 XML，直接渲染该字段。
   * 旧 llm.input.json 文件没有该字段，UI 应做兼容判断。
   */
  contextSnapshot?: ContextSnapshot;
}

/** LLM 返回后写入的输出快照。 */
export interface LlmOutputDebugRecord {
  /** 触发本次请求的线程 ID。 */
  threadId: string;
  /** 本轮归一化后的 output items。 */
  outputItems: LlmInputItem[];
  /** 便于人工检查的 provider 元信息。 */
  provider?: string;
  model?: string;
}

/**
 * loop 级 debug 元数据，帮助排查每轮上下文与耗时。
 *
 * P2 注意：windowsSnapshot 字段类型为 unknown[]（原来依赖 WindowSnapshotEntry
 * from window-hash.ts，该文件已按 spec V2 §6.1 删除）。P4+ 重设计。
 */
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
  /**
   * P2 slim: 原 WindowSnapshotEntry[] 塌缩为 unknown[]。
   * observable 层在 P4+ 阶段用 ObjectRecord-aware 语义重新填充。
   */
  windowsSnapshot?: unknown[];
}

function toMessageItem(message: LlmMessage): LlmInputItem {
  return {
    type: "message",
    role: message.role,
    content: message.content
  };
}

/** 兼容过渡期：旧消息数组在落盘前一律转成 item。 */
export function normalizeInputItems(items: LlmInputItem[] | LlmMessage[]): LlmInputItem[] {
  return items.map((item) => ("type" in item ? item : toMessageItem(item)));
}

/** 把当前归一化结果投影成 output items；provider 完成迁移后可直接使用原生 output。 */
export function deriveOutputItems(result: LlmGenerateResult): LlmInputItem[] {
  const items: LlmInputItem[] = [];
  if (result.thinking) {
    items.push({ type: "reasoning", text: result.thinking });
  }
  if (result.text) {
    items.push({ type: "message", role: "assistant", content: result.text });
  }
  for (const toolCall of result.toolCalls) {
    items.push({
      type: "function_call",
      call_id: toolCall.id,
      name: toolCall.name,
      arguments: toolCall.arguments
    });
  }
  return items;
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

/**
 * 读取单轮 LLM 元数据；文件不存在 / 解析失败时返回 undefined（不抛）。
 */
export async function readLoopDebugMeta(
  ref: ThreadPersistenceRef,
  loopIndex: number
): Promise<LlmLoopDebugMetaRecord | undefined> {
  try {
    const raw = await readFile(loopMetaFile(ref, loopIndex), "utf8");
    return JSON.parse(raw) as LlmLoopDebugMetaRecord;
  } catch {
    return undefined;
  }
}
