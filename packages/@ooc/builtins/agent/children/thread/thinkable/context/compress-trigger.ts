/**
 * compress v2 —— 自动压缩触发的纯判定（无副作用，可单测）。
 *
 * `autoCompressLevel`（thread 窗经 window method `resize` 设）映射为**未总结 transcript token 阈值**：
 * 越高档越激进 = 越低阈值。level 0/缺省 = 阈值取 hard（即不主动自动压缩，仅 force-wait 在超 hard 时兜底触发）。
 * 实际 spawn summarizer fork 是副作用，由 thinkloop 的 framework hook 据本判定执行（本文件只算阈值/是否触发）。
 */
import type { BudgetThresholds } from "./budget.js";

/** autoCompressLevel → 未总结 transcript token 阈值。 */
export function autoCompressThreshold(
  level: 0 | 1 | 2 | undefined,
  thresholds: BudgetThresholds,
): number {
  switch (level) {
    case 2:
      return Math.floor(thresholds.soft / 2);
    case 1:
      return thresholds.soft;
    default:
      return thresholds.hard;
  }
}

/**
 * 是否应触发一次自动压缩。transcript-gated（H3：只看未总结 transcript，不看 windows——windows 超限由
 * BudgetManager overflow 处理，与 compress 正交，避免 windows 主导超限时反复 fork 的 livelock）。
 * 触发条件：`compressIntent`（agent 手动请求）OR 未总结 transcript token > 阈值；且无在途 compress。
 */
export function shouldAutoCompress(args: {
  transcriptTokens: number;
  autoCompressLevel: 0 | 1 | 2 | undefined;
  compressIntent: boolean | undefined;
  inFlight: boolean;
  thresholds: BudgetThresholds;
}): boolean {
  if (args.inFlight) return false;
  if (args.compressIntent) return true;
  return args.transcriptTokens > autoCompressThreshold(args.autoCompressLevel, args.thresholds);
}
