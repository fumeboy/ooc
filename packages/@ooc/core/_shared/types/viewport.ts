/**
 * viewport 协议纯类型 + 纯函数 —— canonical 源（batch C2 从
 * `executable/windows/_shared/viewport.ts` + `transcript-viewport.ts` 迁入）。
 *
 * 两套互补的"窗口节流"机制：
 * - file / knowledge window：行+列二维裁剪（`Viewport` / `applyViewport` / …）
 * - talk / do window：transcript 末 N 条或固定区间（`TranscriptViewport` / …）
 *
 * 不含 runtime 执行入口：`executeWindowSetViewport` /
 * `executeWindowSetTranscriptViewport` 依赖 `MethodExecutionContext` 且对
 * `ctx.self` 写副作用，留在 `executable/windows/_shared/{viewport,transcript-viewport}.ts`。
 *
 * 详见 docs/refactor_0604/shared-types.md §3.8、
 * meta/object.doc.ts:executable.context_window.patches.viewport_protocol。
 */

// ─────────────────────────── file / knowledge viewport ───────────────────────

export interface Viewport {
  lineStart: number;
  lineEnd: number;
  columnStart: number;
  columnEnd: number;
}

export const DEFAULT_VIEWPORT: Viewport = Object.freeze({
  lineStart: 0,
  lineEnd: 200,
  columnStart: 0,
  columnEnd: 200,
});

export interface ViewportArgs {
  line_start?: number;
  line_end?: number;
  column_start?: number;
  column_end?: number;
}

/**
 * 校验+合并 viewport 部分字段到 current。任一字段非法立即返回错误（fail-loud）。
 *
 * 合法性约束：
 * - 必须是非负整数（含 0）
 * - lineStart <= lineEnd
 * - columnStart <= columnEnd
 *
 * 未传字段保留 current 值（partial merge 语义）。
 */
export function mergeViewport(
  current: Viewport,
  args: Record<string, unknown>,
): { ok: true; viewport: Viewport } | { ok: false; error: string } {
  const next: Viewport = { ...current };

  const fields: Array<[keyof Viewport, string]> = [
    ["lineStart", "line_start"],
    ["lineEnd", "line_end"],
    ["columnStart", "column_start"],
    ["columnEnd", "column_end"],
  ];

  for (const [key, argName] of fields) {
    if (!(argName in args)) continue;
    const raw = args[argName];
    if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 0) {
      return {
        ok: false,
        error: `${argName} 必须是非负整数 (got: ${JSON.stringify(raw)})`,
      };
    }
    next[key] = raw;
  }

  if (next.lineStart > next.lineEnd) {
    return {
      ok: false,
      error: `line_start (${next.lineStart}) > line_end (${next.lineEnd})`,
    };
  }
  if (next.columnStart > next.columnEnd) {
    return {
      ok: false,
      error: `column_start (${next.columnStart}) > column_end (${next.columnEnd})`,
    };
  }

  return { ok: true, viewport: next };
}

/**
 * 是否带任意 viewport 字段。用于 set_viewport 的入参提示。
 */
export function hasAnyViewportField(args: Record<string, unknown>): boolean {
  return (
    "line_start" in args ||
    "line_end" in args ||
    "column_start" in args ||
    "column_end" in args
  );
}

/**
 * 按 viewport 切分原始文本，返回带溢出提示的渲染文本。
 *
 * 行维度：
 * - 取 lines[lineStart .. lineEnd)
 * - 总行数 > lineEnd 时尾部追加 `…(+N more lines)`
 *
 * 列维度（对每一行独立应用）：
 * - 取 line.slice(columnStart, columnEnd)
 * - columnStart > 0 且原行长 > columnStart 时行首加 `(+N before)…`
 * - 原行长 > columnEnd 时行尾加 `…(+N more)`
 *
 * 空字符串输入返回空串（无 marker）。
 */
export function applyViewport(raw: string, viewport: Viewport): string {
  if (raw === "") return "";

  const allLines = raw.split("\n");
  const total = allLines.length;
  const sliced = allLines.slice(viewport.lineStart, viewport.lineEnd);

  const rendered = sliced.map((line) =>
    sliceColumn(line, viewport.columnStart, viewport.columnEnd),
  );

  let body = rendered.join("\n");
  if (total > viewport.lineEnd) {
    const more = total - viewport.lineEnd;
    body = body + `\n…(+${more} more lines)`;
  }
  return body;
}

/**
 * 单行字符截断（字符级，不感知 markdown / 不感知 Unicode grapheme cluster）。
 *
 * 极端 case:
 * - line 长度 <= columnStart：返回空串（行尾 marker 也省略，整行被裁掉无意义）
 * - 中段不可见但首尾 marker 仍需如实标出
 */
export function sliceColumn(line: string, columnStart: number, columnEnd: number): string {
  const total = line.length;
  if (total === 0) return "";
  // 整行落在 columnStart 之前 → 空
  if (total <= columnStart) return "";

  const visible = line.slice(columnStart, columnEnd);
  let out = visible;
  if (columnStart > 0) {
    out = `(+${columnStart} before)…` + out;
  }
  if (total > columnEnd) {
    const more = total - columnEnd;
    out = out + `…(+${more} more)`;
  }
  return out;
}

// ─────────────────────────── talk / do transcript viewport ───────────────────

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
