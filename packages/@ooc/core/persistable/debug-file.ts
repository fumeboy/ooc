import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { threadDir, toJson, type ThreadPersistenceRef } from "./common";
import type { LlmGenerateResult, LlmInputItem, LlmMessage } from "../thinkable/llm/types";
import type { ProcessEvent, ThreadContext, ThreadMessage } from "../thinkable/context";
import type { ContextWindow } from "../executable/windows/_shared/types";
import type { ObjectRegistry } from "../executable/windows/_shared/registry.js";
import { builtinRegistry } from "../executable/windows/index.js";
import type { WindowSnapshotEntry } from "@ooc/core/observable/window-hash";

/**
 * 调用 LLM 前同时落盘的 thread context 快照。
 *
 * 与 inputItems 中的 system message XML 一一对应，但用结构化 JSON 表示，
 * 方便 UI 直接消费（无需重新 parse XML）。spec § 渲染示例。
 */
export interface ContextSnapshot {
  id: string;
  status?: string;
  contextWindows: ContextWindow[];
  inbox?: ThreadMessage[];
  outbox?: ThreadMessage[];
  events?: ProcessEvent[];
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

/** 从 thread 中抽取调用 LLM 时刻的快照子集。 */
export function captureContextSnapshot(
  thread: ThreadContext,
  registry: ObjectRegistry = builtinRegistry,
): ContextSnapshot {
  // batch C narrowing(N4): contextWindows 契约层是 base[]；narrow 回 union[] 以匹配 ContextSnapshot.contextWindows。
  const contextWindows = ((thread.contextWindows ?? []) as ContextWindow[]).map((w) => {
    // P6.§7: enrichment effectiveVisibleType（沿 parentClass 继承链回退到可渲染 type）。
    const effVis = registry.resolveEffectiveVisibleType(w.class as any);
    if (effVis && effVis !== w.class) {
      return { ...w, effectiveVisibleType: effVis };
    }
    return w;
  });
  return {
    id: thread.id,
    status: thread.status,
    contextWindows,
    inbox: thread.inbox,
    outbox: thread.outbox,
    events: thread.events,
    creatorThreadId: thread.creatorThreadId,
    parentThreadId: thread.parentThreadId,
  };
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
  /**
   * 本轮调用 LLM 时刻 thread.contextWindows 的 hash 快照。
   *
   * - 数据由 observable/window-hash.ts:buildWindowsSnapshot 计算
   * - 前端 LoopTimeline 用相邻 loop 的 windowsSnapshot 在客户端算 diff
   *   (added / removed / changed / unchanged)
   * - optional：向后兼容旧 loop_NNNN.meta.json
   */
  windowsSnapshot?: WindowSnapshotEntry[];
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

/** 写 debug 文件：mkdir -p debug 目录 + 序列化 record 覆盖写。 */
async function writeDebugFile(
  ref: ThreadPersistenceRef,
  file: string,
  record: unknown,
): Promise<void> {
  await mkdir(debugDir(ref), { recursive: true });
  await writeFile(file, toJson(record), "utf8");
}

/** 写入最近一次 LLM 输入快照，覆盖旧文件。 */
export function writeDebugInput(ref: ThreadPersistenceRef, record: LlmInputDebugRecord): Promise<void> {
  return writeDebugFile(ref, llmInputFile(ref), record);
}

/** 写入最近一次 LLM 输出快照，覆盖旧文件。 */
export function writeDebugOutput(ref: ThreadPersistenceRef, record: LlmOutputDebugRecord): Promise<void> {
  return writeDebugFile(ref, llmOutputFile(ref), record);
}

/** 写入单轮 LLM 输入快照。 */
export function writeLoopDebugInput(
  ref: ThreadPersistenceRef,
  loopIndex: number,
  record: LlmInputDebugRecord,
): Promise<void> {
  return writeDebugFile(ref, loopInputFile(ref, loopIndex), record);
}

/** 写入单轮 LLM 输出快照。 */
export function writeLoopDebugOutput(
  ref: ThreadPersistenceRef,
  loopIndex: number,
  record: LlmOutputDebugRecord,
): Promise<void> {
  return writeDebugFile(ref, loopOutputFile(ref, loopIndex), record);
}

/** 写入单轮 LLM 元数据。 */
export function writeLoopDebugMeta(
  ref: ThreadPersistenceRef,
  loopIndex: number,
  record: LlmLoopDebugMetaRecord,
): Promise<void> {
  return writeDebugFile(ref, loopMetaFile(ref, loopIndex), record);
}

/**
 * 读取单轮 LLM 元数据；文件不存在 / 解析失败时返回 undefined（不抛）。
 *
 * Round 10 F2 引入：finishLlmLoop 在写 loop_NNNN.meta.json 前先读 loop_NNNN-1.meta.json
 * 拿 prev snapshot，给 buildWindowsSnapshot 算 file_window 的 previousContent。
 *
 * 失败退化语义（首次出现 / 文件被外部删 / JSON 损坏）→ undefined →
 * buildWindowsSnapshot 把 previousContent 当 ""（视为 added）。
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
