/**
 * observable —— OOC 旁路观测层（非维度）。
 *
 * 铁律：**不改变 agent 行为**。只观测、不介入。
 *
 * 当前最小重建：
 * - **log-aggregator**：单一 console 收口，去重 + 限流（observeLog / observeWarn / logPatternSnapshot）
 * - **LlmObservation**：最近一次 LLM 调用的内存快照（供测试与控制面查询）
 * - **debug 开关**：enableDebug / disableDebug（toggle 后续 loop-level 落盘）
 *
 * 后续重建：
 * - loop-level debug 文件落盘（thinkloop 周围每轮 input/output/meta 落 flows/<sid>/.../debug/）
 * - PauseChecker（tool call 执行前介入暂停）
 * - ContextSnapshot（每轮 context 结构化快照供前端 diff）
 *
 * 设计权威：`.ooc-world-meta/.../children/observable/self.md`。
 */
import type {
  LlmGenerateResult,
  LlmInputItem,
  LlmTool,
} from "../thinkable/llm/types.js";

export { observeLog, observeWarn, logPatternSnapshot, __resetLogAggregatorForTests } from "./log-aggregator.js";
export type { LogPatternSnapshot } from "./log-aggregator.js";

// ─────────────────────── LlmObservation ───────────────────────

export interface LlmObservation {
  input?: {
    threadId: string;
    inputItems: LlmInputItem[];
    tools: LlmTool[];
    at: number;
  };
  output?: {
    threadId: string;
    result: LlmGenerateResult;
    at: number;
  };
}

let latestLlmObservation: LlmObservation | undefined;

export function setLatestLlmInput(threadId: string, inputItems: LlmInputItem[], tools: LlmTool[]): void {
  latestLlmObservation = {
    ...(latestLlmObservation ?? {}),
    input: { threadId, inputItems, tools, at: Date.now() },
  };
}

export function setLatestLlmOutput(threadId: string, result: LlmGenerateResult): void {
  latestLlmObservation = {
    ...(latestLlmObservation ?? {}),
    output: { threadId, result, at: Date.now() },
  };
}

export function getLatestLlmObservation(): LlmObservation | undefined {
  return latestLlmObservation;
}

export function clearLatestLlmObservation(): void {
  latestLlmObservation = undefined;
}

// ─────────────────────── debug 开关 ───────────────────────

let debugEnabled = false;

export function enableDebug(): void {
  debugEnabled = true;
}

export function disableDebug(): void {
  debugEnabled = false;
}

export function getDebugStatus(): { enabled: boolean } {
  return { enabled: debugEnabled };
}
