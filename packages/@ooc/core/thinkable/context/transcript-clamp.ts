/**
 * transcript 应急 budget 钳制 —— 自己视角 transcript 的「窗 overflow」等价物。
 *
 * 背景：transcript（thread event + creator 对话）是自己视角 thread window 的内容通道
 * （context.md 核心 10），与窗口一并计入预算账（见 `budget.ts:estimateTranscriptTokens`）。
 * 窗口超 hard 由 `BudgetManager.allocate` per-round 踢进 overflow（瞬态、不持久化）；transcript
 * 没有等价保护——events append-only 无界增长，agent 不主动 `compress` 则终将撑爆 context。
 *
 * 本模块补上这层**应急兜底**：current 越 hard 时把 transcript 钳到预算内（丢最早、留最近），
 * 与窗 overflow **同模型**——per-round、瞬态、**不改 `thread.events`、不动 win、不持久化、不生成摘要**。
 * 它只是"本轮渲染少喂点最早历史"，不是"自动推进压缩档位"（不违 `budget.ts` 预算不自动推进档位的不变量）。
 * v2 关系：这是 force-wait（在途 summarizer fork 时强制等待，`compress-fork.ts:maybeForceWaitForCompress`）
 * 之下的 **clamp floor**——force-wait 等不及（无在途 fork 却已溢出 / fork 未回）时仍保证不崩。
 * agent 仍可（且应）主动 `exec(method="compress")`（无参意图）持久折叠——那是 agent 的上下文工程主权。
 *
 * **tool-pair 安全**：钳制保留的是 transcript 的**后缀**；function_call 必排在其 function_call_output
 * 之前，故后缀里不会出现"call 在后缀内、output 被丢"的孤儿 call，只可能出现"output 在后缀内、其 call
 * 在被丢前缀里"的孤儿 output——sanitize 丢掉这类孤儿 output 即可（provider 层不 sanitize，孤儿
 * tool_result 会被 Anthropic/OpenAI 拒，必须在此堵住）。
 */
import type { LlmInputItem } from "../llm/types";
import { estimateTranscriptTokens } from "./budget.js";

export interface TranscriptClampResult {
  /** 钳制后保留的 transcript items（后缀 + 孤儿 output 已剔）。 */
  kept: LlmInputItem[];
  /** 被省略的最早 items 数（前缀长度；0 = 未钳制）。 */
  omittedCount: number;
}

/** 应急钳制下至少保留的最近 items 数（哪怕单条超预算也不清空，避免空 transcript）。 */
export const TRANSCRIPT_CLAMP_FLOOR_ITEMS = 1;

/**
 * 把 transcript 钳到 token 预算内：从尾部累加保留最近 items，丢最早；至少保留 `floorItems` 条；
 * 再 tool-pair sanitize（丢孤儿 function_call_output）。纯函数。
 */
export function clampTranscriptToBudget(
  transcript: LlmInputItem[],
  budget: number,
  floorItems: number = TRANSCRIPT_CLAMP_FLOOR_ITEMS,
): TranscriptClampResult {
  if (transcript.length === 0) return { kept: transcript, omittedCount: 0 };

  let used = 0;
  let start = transcript.length;
  for (let i = transcript.length - 1; i >= 0; i--) {
    const t = estimateTranscriptTokens([transcript[i]]);
    const keptIfInclude = transcript.length - i;
    // 超预算就停——但不足 floor 时强制保留（floor 优先于预算，避免空 transcript）。
    if (used + t > budget && keptIfInclude > floorItems) break;
    used += t;
    start = i;
  }

  if (start <= 0) return { kept: transcript, omittedCount: 0 };

  const suffix = transcript.slice(start);
  // 后缀里 function_call 的 call_id 集合；丢掉 call_id 不在其中的孤儿 output。
  const callIds = new Set<string>();
  for (const it of suffix) {
    if (it.type === "function_call") callIds.add(it.call_id);
  }
  const kept = suffix.filter(
    (it) => !(it.type === "function_call_output" && !callIds.has(it.call_id)),
  );
  return { kept, omittedCount: start };
}
