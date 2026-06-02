import type { CommandExecutionContext } from "./command-types.js";
import type { ContextWindow } from "./types.js";

/**
 * viewport 协议 — file_window / knowledge_window 共享的"精细化窗口大小"控制。
 *
 * 设计：
 * - 每个 window 持一组 viewport = { lineStart, lineEnd, columnStart, columnEnd }
 *   - 默认值：lineStart=0 / lineEnd=200 / columnStart=0 / columnEnd=200
 * - LLM 通过 `set_viewport` 命令调整任意子集字段（未传字段保留当前值）
 * - 渲染层（render）按 viewport 切行 + 切列：
 *     content.split('\n').slice(lineStart, lineEnd).map(sliceColumn(columnStart, columnEnd))
 *   超 lineEnd 标 `…(+N more lines)`；超 columnEnd 标 `…(+N more)`；columnStart>0 标 `(+N before)…`
 * - viewport 仅影响**渲染**给 LLM 的内容；edit / reload 等命令仍基于文件/knowledge 完整内容
 *
 * 详见 meta/object.doc.ts:executable.context_window.patches.viewport_protocol。
 */

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
 * file / knowledge window 共享的 set_viewport 执行入口。
 *
 * - 校验 ctx.self 是目标 type
 * - 校验至少有一个 viewport 字段（否则 no-op + 提示）
 * - 合并 + fail-loud 校验
 * - Object.assign 写回 window（按现有 set_range 的同模式，保证 manager.toData() 写回持久层）
 */
export async function executeWindowSetViewport(
  ctx: CommandExecutionContext,
  expectedType: "file" | "knowledge",
): Promise<string | undefined> {
  // P6.§3: manager 在 dispatch 阶段已保证 self.type === expectedType（caller 注册的），
  // method 体不再 re-check self 类型。expectedType 仅用于错误文案 label。
  const window = ctx.self as ContextWindow;
  if (!hasAnyViewportField(ctx.args)) {
    return `[${expectedType}_window.set_viewport] 至少需要传入 line_start / line_end / column_start / column_end 之一。`;
  }
  // 注：FileWindow / KnowledgeWindow 都有 viewport?: Viewport（缺省 = DEFAULT_VIEWPORT）
  const current = (window as { viewport?: Viewport }).viewport ?? DEFAULT_VIEWPORT;
  const merged = mergeViewport(current, ctx.args);
  if (!merged.ok) {
    return `[${expectedType}_window.set_viewport] ${merged.error}`;
  }
  Object.assign(window, { viewport: merged.viewport });
  return undefined;
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
