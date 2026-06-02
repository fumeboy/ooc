import type { CommandExecutionContext } from "./command-types.js";
import type { ContextWindow } from "./types.js";

/**
 * transcript viewport 协议 — talk_window / do_window 共享的"持续对话窗口节流"控制。
 *
 * 设计：
 * - 每个 talk/do window 持一组 transcriptViewport = { tail? } 或 { rangeStart, rangeEnd }（互斥）
 *   - 默认值：{ tail: 20 } —— 只渲染 transcript 末 20 条
 * - LLM 通过 `set_transcript_window` 命令切换：
 *     - args={ tail: 50 } → 切到末 50 条（清掉 range）
 *     - args={ range_start: 0, range_end: 30 } → 切到固定区间 transcript[rangeStart, rangeEnd)（清掉 tail）
 * - 不允许同时存在 tail + range；同一次 args 同时含两者立刻 fail-loud
 * - 渲染层（render）按 viewport 截 transcript：
 *     - tail 模式: 取 transcript.slice(-tail)；前面记为 earlierCount = total - visible.length
 *     - range 模式: 取 transcript.slice(rangeStart, rangeEnd)；earlierCount = rangeStart
 *   超出部分用 `<transcript_viewport tail=N total=M/>` 或 `<transcript_viewport range_start=i range_end=j total=M/>`
 *   XML 节点表达；前部省略数另由 render 层暴露（按 transcript 元素自行决定 marker 形式）。
 * - transcript 总数 ≤ tail 或 ≤ range 区间 → 等价全部展开
 *
 * 详见 meta/object.doc.ts:executable.context_window.patches.viewport_protocol。
 */

export interface TranscriptViewport {
  /** 显示末 N 条消息；与 range 互斥。 */
  tail?: number;
  /** 区间起点（含；从 0 开始）；与 tail 互斥；必须与 rangeEnd 同时存在。 */
  rangeStart?: number;
  /** 区间终点（不含）；与 tail 互斥；必须与 rangeStart 同时存在。 */
  rangeEnd?: number;
}

export const DEFAULT_TRANSCRIPT_VIEWPORT: TranscriptViewport = Object.freeze({
  tail: 20,
});

export interface TranscriptViewportArgs {
  tail?: number;
  range_start?: number;
  range_end?: number;
}

/**
 * 校验+合并 transcript viewport。
 *
 * 合法性约束（fail-loud）：
 * - tail 必须是正整数（>= 1）
 * - rangeStart / rangeEnd 必须是非负整数（含 0）
 * - rangeStart ≤ rangeEnd
 * - rangeStart 与 rangeEnd 必须同时出现（不接受只传一个）
 * - tail 与 range_* 互斥（同一次 args 不能同时含 tail 与 range_start/range_end）
 *
 * 语义：tail 与 range 互斥切换——传 tail 的 args 清空 range；传 range 的 args 清空 tail。
 * 缺省 args（既无 tail 又无 range）视为 no-op，返回当前 viewport。
 */
export function mergeTranscriptViewport(
  current: TranscriptViewport,
  args: Record<string, unknown>,
): { ok: true; viewport: TranscriptViewport } | { ok: false; error: string } {
  const hasTail = "tail" in args;
  const hasRangeStart = "range_start" in args;
  const hasRangeEnd = "range_end" in args;

  if (hasTail && (hasRangeStart || hasRangeEnd)) {
    return {
      ok: false,
      error:
        "tail 与 range_start/range_end 互斥；同一次调用只传其一",
    };
  }

  if ((hasRangeStart && !hasRangeEnd) || (!hasRangeStart && hasRangeEnd)) {
    return {
      ok: false,
      error: "range_start 与 range_end 必须同时出现",
    };
  }

  if (hasTail) {
    const raw = args.tail;
    if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 1) {
      return {
        ok: false,
        error: `tail 必须是正整数 (got: ${JSON.stringify(raw)})`,
      };
    }
    // tail 模式：清掉 range
    return { ok: true, viewport: { tail: raw } };
  }

  if (hasRangeStart && hasRangeEnd) {
    const rs = args.range_start;
    const re = args.range_end;
    if (typeof rs !== "number" || !Number.isInteger(rs) || rs < 0) {
      return {
        ok: false,
        error: `range_start 必须是非负整数 (got: ${JSON.stringify(rs)})`,
      };
    }
    if (typeof re !== "number" || !Number.isInteger(re) || re < 0) {
      return {
        ok: false,
        error: `range_end 必须是非负整数 (got: ${JSON.stringify(re)})`,
      };
    }
    if (rs > re) {
      return {
        ok: false,
        error: `range_start (${rs}) > range_end (${re})`,
      };
    }
    // range 模式：清掉 tail
    return { ok: true, viewport: { rangeStart: rs, rangeEnd: re } };
  }

  // 既无 tail 又无 range —— no-op，返回当前 viewport
  return { ok: true, viewport: current };
}

/**
 * 是否带任意 transcript viewport 字段。用于 set_transcript_window 的入参提示。
 */
export function hasAnyTranscriptViewportField(args: Record<string, unknown>): boolean {
  return "tail" in args || "range_start" in args || "range_end" in args;
}

/**
 * 按 viewport 截 transcript。返回:
 * - visible:      可见消息数组（依然按原顺序）
 * - earlierCount: 被省略的"较早"消息数（视为前部省略）；
 *                 tail 模式 = total - visible.length；
 *                 range 模式 = rangeStart（仅截到 rangeEnd 也仅暴露前部 earlier，便于 render 标摘要）
 *
 * total <= 渲染区间时 visible = 完整 messages，earlierCount = 0。
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

  if (
    typeof viewport.rangeStart === "number" &&
    typeof viewport.rangeEnd === "number"
  ) {
    const rs = Math.max(0, viewport.rangeStart);
    const re = Math.min(total, viewport.rangeEnd);
    const visible = messages.slice(rs, re);
    return { visible, earlierCount: rs };
  }

  // 兜底（既无合法 tail 也无合法 range）—— 全展开，与默认一致
  return { visible: messages, earlierCount: 0 };
}

/**
 * talk_window / do_window 共享的 set_transcript_window 执行入口。
 *
 * - 校验 ctx.self 是 expectedTypes 中某一种
 * - 校验至少有一个 tail / range_start / range_end 字段（否则 no-op + 提示）
 * - 合并 + fail-loud 校验
 * - Object.assign 写回 window.transcriptViewport（按现有 set_viewport 的同模式）
 */
export async function executeWindowSetTranscriptViewport(
  ctx: CommandExecutionContext,
  expectedTypes: Array<"talk" | "do">,
): Promise<string | undefined> {
  // P6.§3: manager 在 dispatch 阶段已保证 self.type 是 caller 注册的 type 之一，
  // method 体不再 re-check self 类型。expectedTypes 仅用于错误文案 label。
  const window = ctx.self as ContextWindow;
  if (!hasAnyTranscriptViewportField(ctx.args)) {
    return `[${window.type}_window.set_transcript_window] 至少需要传入 tail / range_start+range_end 之一。`;
  }
  const current =
    (window as { transcriptViewport?: TranscriptViewport }).transcriptViewport ??
    DEFAULT_TRANSCRIPT_VIEWPORT;
  const merged = mergeTranscriptViewport(current, ctx.args);
  if (!merged.ok) {
    return `[${window.type}_window.set_transcript_window] ${merged.error}`;
  }
  Object.assign(window, { transcriptViewport: merged.viewport });
  return undefined;
}
