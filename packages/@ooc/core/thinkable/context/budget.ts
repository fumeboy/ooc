/**
 * Context budget — BudgetManager。
 *
 * 预算是 context 唯一的自动裁剪闸门：
 *   - score(window): 由 provenance / priority / recency / signalCount 算出 0.0–1.0 相关性
 *   - allocate(windows, totalBudget, estimateTokenFn?): 按相关性排序, 在 token 预算内
 *     返回 { visible, overflow }; overflow 不丢, 由 renderer 的 <context_overflow> 呈现
 *
 * compressLevel 仅由 LLM 的 compress/expand 命令与 renderer 显式控制——预算不自动推进档位。
 *
 * 配置: stones/<self>/config/context-budget.json
 *   { "budget": { "soft": number, "hard": number } }
 * loadBudgetThresholds 读取 soft/hard 阈值。
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

import type { ContextWindow } from "../../executable/windows/_shared/types";
import { deriveStoneFromThread, stoneDir } from "../../persistable/common";
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
 * BudgetManager — 基于语义相关性打分 + token 预算分配的 context 裁剪器。
 */

const PROVENANCE_WEIGHTS: Record<string, number> = {
  explicit: 1.0,
  derived: 0.7,
  related: 0.5,
  system: 0.8,
};

const PRIORITY_WEIGHTS: Record<string, number> = {
  critical: 1.0,
  high: 0.9,
  normal: 0.6,
  low: 0.3,
};

export class BudgetManager {
  /**
   * Compute a 0.0–1.0 relevance score for a context window.
   *
   * Uses: provenance.kind weight, priorityHint weight, recency (time since lastTouchedAt),
   * signalCount (decaying counter of recent references).
   *
   * If the window already has relevance.score set, it's used as the baseline and
   * the other factors are blended in.
   */
  score(window: ContextWindow, now: number = Date.now()): number {
    const p = window.provenance;
    const r = window.relevance;

    // Base from existing relevance or provenance default
    let score = r?.score ?? PROVENANCE_WEIGHTS[p?.kind ?? "explicit"];

    // Priority hint boost
    if (r?.priorityHint) {
      score = score * 0.6 + PRIORITY_WEIGHTS[r.priorityHint] * 0.4;
    }

    // Recency: windows touched in last 5 minutes get a boost; very old windows decay
    if (p?.lastTouchedAt) {
      const ageMs = now - p.lastTouchedAt;
      const ageHours = ageMs / (1000 * 60 * 60);
      if (ageMs < 5 * 60 * 1000) {
        score = Math.min(1.0, score * 1.1); // Recent boost
      } else if (ageHours > 1) {
        score *= Math.max(0.3, 1.0 - (ageHours - 1) * 0.1); // Decay 10% per hour after first hour, floor at 0.3
      }
    }

    // Signal count: higher recent signal count = higher relevance
    if (r?.signalCount) {
      const signalBoost = Math.min(0.2, r.signalCount * 0.02);
      score = Math.min(1.0, score + signalBoost);
    }

    return Math.max(0.0, Math.min(1.0, score));
  }

  /**
   * Allocate windows to a token budget.
   *
   * @param windows All candidate windows (already enriched with scored relevance)
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

    // Score all windows
    const now = Date.now();
    const scored = windows.map(w => ({
      window: w,
      score: this.score(w, now),
      tokens: estimate(w),
    }));

    // Guidance windows bound to a form inherit the form's score
    const formScores = new Map<string, number>();
    for (const s of scored) {
      if (s.window.type === "method_exec") {
        formScores.set(s.window.id, s.score);
      }
    }
    for (const s of scored) {
      if (s.window.boundFormId && formScores.has(s.window.boundFormId) && s.window.parentWindowId === s.window.boundFormId) {
        // Guidance inherits form's relevance (never lower than its own score)
        s.score = Math.max(s.score, formScores.get(s.window.boundFormId)!);
      }
    }

    // Sort descending by relevance score
    scored.sort((a, b) => b.score - a.score);

    const visible: typeof windows = [];
    const overflow: Array<{ id: string; title: string; relevance: number; reason: string }> = [];
    let used = 0;

    for (const s of scored) {
      if (used + s.tokens <= totalBudget) {
        visible.push(s.window);
        used += s.tokens;
      } else {
        overflow.push({
          id: s.window.id,
          title: s.window.title,
          relevance: s.score,
          reason: used > 0 ? "budget_overflow" : "window_too_large_for_budget",
        });
      }
    }

    return { visible, overflow };
  }
}
