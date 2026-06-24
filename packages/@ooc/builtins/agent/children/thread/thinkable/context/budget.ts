/**
 * Context budget — BudgetManager。
 *
 * 预算是 context 唯一的自动裁剪闸门：
 *   - allocate(windows, totalBudget, estimateTokenFn?): 按 in-order token 预算裁剪,
 *     在 token 预算内返回 { visible, overflow }; overflow 不丢, 由 renderer 的
 *     <context_overflow> 呈现
 *
 * compressLevel 仅由内容窗各自实现的 `resize`（设档位）与 renderer 显式控制——预算不自动推进档位。
 *
 * 配置: stones/<self>/config/context-budget.json
 *   { "budget": { "soft": number, "hard": number } }
 * loadBudgetThresholds 读取 soft/hard 阈值。
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

// budget 只读 id/title；用 canonical ContextWindow（= OocObjectRef）。
import type { ContextWindow } from "@ooc/core/types/context-window.js";
import { deriveStoneFromThread, stoneDir } from "@ooc/core/persistable/common";
import type { ThreadContext } from "./index";

// ─────────────────────────── config ──────────────────────────────────────────

/** Budget 阈值配置 (token 估算 soft/hard 上限)。 */
export interface BudgetThresholds {
  /** soft 阈值: 可见窗口 token 超过即给 LLM 一条 <context_budget_warning>; 默认 100000 字符 (≈ 25K token 粗估)。 */
  soft: number;
  /** hard 阈值: allocate 的 token 预算上限, 超出的窗口归入 overflow (不渲染但保留); 默认 180000。 */
  hard: number;
}

export const DEFAULT_BUDGET_THRESHOLDS: BudgetThresholds = {
  soft: 100000,
  hard: 180000,
};

/**
 * 单窗口 token 估算的唯一来源：JSON 序列化长度 / 4 的启发式。
 * BudgetManager.allocate 与 soft-warning 检测共用同一份，避免估算口径漂移。
 */
export function estimateWindowTokens(w: ContextWindow): number {
  try {
    return Math.ceil(JSON.stringify(w).length / 4);
  } catch {
    return 100;
  }
}

/** 一组窗口的 token 估算之和。 */
export function estimateWindowsTokens(windows: ContextWindow[]): number {
  let total = 0;
  for (const w of windows) total += estimateWindowTokens(w);
  return total;
}

/**
 * transcript（LLM input items：thread event + creator 对话）的 token 估算之和。
 *
 * 与 {@link estimateWindowTokens} **同口径**（JSON 序列化长度 / 4），避免估算漂移。
 * transcript 是自己视角 thread window 的内容通道（context.md 核心 10），与窗口一并计入预算账
 * —— 它走 message 流而非 XML 窗内容，故此前未被 `estimateWindowsTokens` 覆盖、游离在预算外。
 */
export function estimateTranscriptTokens(items: readonly unknown[]): number {
  let total = 0;
  for (const item of items) {
    try {
      total += Math.ceil(JSON.stringify(item).length / 4);
    } catch {
      total += 100;
    }
  }
  return total;
}

/** 从 stone 配置 / 默认值加载 budget 阈值。 */
export function loadBudgetThresholds(thread: ThreadContext): BudgetThresholds {
  const parsed = readBudgetConfigFile(thread);
  const b = parsed?.budget ?? {};
  return {
    soft: typeof b.soft === "number" && b.soft > 0 ? b.soft : DEFAULT_BUDGET_THRESHOLDS.soft,
    hard: typeof b.hard === "number" && b.hard > 0 ? b.hard : DEFAULT_BUDGET_THRESHOLDS.hard,
  };
}

interface BudgetConfigFile {
  budget?: Partial<BudgetThresholds>;
}

/** 读取 stone 上的 context-budget.json; 失败 / 缺失一律返回 null。仅 loadBudgetThresholds 使用。 */
function readBudgetConfigFile(thread: ThreadContext): BudgetConfigFile | null {
  if (!thread.persistence) return null;
  let configPath: string;
  try {
    const stoneRef = deriveStoneFromThread(thread.persistence);
    configPath = join(stoneDir(stoneRef), "config", "context-budget.json");
  } catch {
    return null;
  }
  if (!existsSync(configPath)) return null;
  try {
    const raw = readFileSync(configPath, "utf8");
    return JSON.parse(raw) as BudgetConfigFile;
  } catch {
    return null;
  }
}

// ─────────────────────────── BudgetManager ───────────────────────────────────

/**
 * BudgetManager — token 预算分配的 context 裁剪器。
 */
export class BudgetManager {
  /**
   * Allocate windows to a token budget.
   *
   * 按入参顺序累加 token，命中预算上限即把剩余窗归入 overflow（不丢，由 renderer 呈现）。
   *
   * @param windows All candidate windows
   * @param totalBudget Max tokens for context windows (not instructions or transcript)
   * @param estimateTokenFn Optional tokenizer function; defaults to JSON.length / 4 (heuristic)
   * @returns { visible: windows in-budget, overflow: windows pushed out with reasons }
   */
  allocate(
    windows: ContextWindow[],
    totalBudget: number,
    estimateTokenFn?: (w: ContextWindow) => number,
  ): {
    visible: ContextWindow[];
    overflow: Array<{ id: string; title: string; relevance: number; reason: string }>;
  } {
    const estimate = estimateTokenFn ?? estimateWindowTokens;

    const visible: ContextWindow[] = [];
    const overflow: Array<{ id: string; title: string; relevance: number; reason: string }> = [];
    let used = 0;

    for (const w of windows) {
      const tokens = estimate(w);
      if (used + tokens <= totalBudget) {
        visible.push(w);
        used += tokens;
      } else {
        overflow.push({
          id: w.id,
          title: w.title,
          relevance: 1.0,
          reason: used > 0 ? "budget_overflow" : "window_too_large_for_budget",
        });
      }
    }

    return { visible, overflow };
  }
}
