/**
 * transcript viewport —— 进程窗 history 的 transcript 末 N 条 / 固定区间裁剪（本 class 自有）。
 *
 * 纯类型 + 纯函数：tail（末 N 条）与 range（固定区间）互斥。readable 装配 mergeTranscriptViewport，投影时 applyTranscriptViewport 截取可见消息。
 */

export interface TranscriptViewport {
  /** 显示末 N 条消息；与 range 互斥。 */
  tail?: number;
  /** 区间起点（含；从 0 开始）；与 tail 互斥；必须与 rangeEnd 同时存在。 */
  rangeStart?: number;
  /** 区间终点（不含）；与 tail 互斥；必须与 rangeStart 同时存在。 */
  rangeEnd?: number;
}

/**
 * 校验+合并 transcript viewport（fail-loud）。
 * - tail 正整数（>=1）；rangeStart/rangeEnd 非负整数且必须同时出现、rangeStart ≤ rangeEnd
 * - tail 与 range_* 互斥；传 tail 清 range、传 range 清 tail；缺省 args 视为 no-op 返回 current。
 */
export function mergeTranscriptViewport(
  current: TranscriptViewport,
  args: Record<string, unknown>,
): { ok: true; viewport: TranscriptViewport } | { ok: false; error: string } {
  const hasTail = "tail" in args;
  const hasRangeStart = "range_start" in args;
  const hasRangeEnd = "range_end" in args;

  if (hasTail && (hasRangeStart || hasRangeEnd)) {
    return { ok: false, error: "tail 与 range_start/range_end 互斥；同一次调用只传其一" };
  }

  if ((hasRangeStart && !hasRangeEnd) || (!hasRangeStart && hasRangeEnd)) {
    return { ok: false, error: "range_start 与 range_end 必须同时出现" };
  }

  if (hasTail) {
    const raw = args.tail;
    if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 1) {
      return { ok: false, error: `tail 必须是正整数 (got: ${JSON.stringify(raw)})` };
    }
    return { ok: true, viewport: { tail: raw } };
  }

  if (hasRangeStart && hasRangeEnd) {
    const rs = args.range_start;
    const re = args.range_end;
    if (typeof rs !== "number" || !Number.isInteger(rs) || rs < 0) {
      return { ok: false, error: `range_start 必须是非负整数 (got: ${JSON.stringify(rs)})` };
    }
    if (typeof re !== "number" || !Number.isInteger(re) || re < 0) {
      return { ok: false, error: `range_end 必须是非负整数 (got: ${JSON.stringify(re)})` };
    }
    if (rs > re) {
      return { ok: false, error: `range_start (${rs}) > range_end (${re})` };
    }
    return { ok: true, viewport: { rangeStart: rs, rangeEnd: re } };
  }

  return { ok: true, viewport: current };
}

/**
 * 按 viewport 截 transcript。返回 visible（可见消息，原顺序）+ earlierCount（前部省略数）。
 * tail 模式 earlierCount = total - visible.length；range 模式 = rangeStart。total ≤ 区间时全展开。
 */
export function applyTranscriptViewport<M>(
  messages: M[],
  viewport: TranscriptViewport,
): { visible: M[]; earlierCount: number } {
  const total = messages.length;
  if (total === 0) {
    return { visible: [], earlierCount: 0 };
  }

  if (typeof viewport.tail === "number" && viewport.tail >= 1) {
    if (total <= viewport.tail) {
      return { visible: messages, earlierCount: 0 };
    }
    const visible = messages.slice(total - viewport.tail);
    return { visible, earlierCount: total - visible.length };
  }

  if (typeof viewport.rangeStart === "number" && typeof viewport.rangeEnd === "number") {
    const rs = Math.max(0, viewport.rangeStart);
    const re = Math.min(total, viewport.rangeEnd);
    const visible = messages.slice(rs, re);
    return { visible, earlierCount: rs };
  }

  return { visible: messages, earlierCount: 0 };
}
