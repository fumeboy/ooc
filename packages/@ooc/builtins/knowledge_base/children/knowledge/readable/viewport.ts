/**
 * 行+列二维 viewport —— knowledge 的 readable 投影裁剪（本 class 自有）。
 *
 * 纯类型 + 纯函数：行维度取 [lineStart, lineEnd)、列维度对每行 slice [columnStart, columnEnd)，
 * 越界尾部/首部加溢出提示。readable 的 set_viewport window method 装配 mergeViewport。
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

/**
 * 校验+合并 viewport 部分字段到 current。任一字段非法立即返回错误（fail-loud）。
 * 约束：非负整数；lineStart <= lineEnd；columnStart <= columnEnd。未传字段保留 current（partial merge）。
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
      return { ok: false, error: `${argName} 必须是非负整数 (got: ${JSON.stringify(raw)})` };
    }
    next[key] = raw;
  }

  if (next.lineStart > next.lineEnd) {
    return { ok: false, error: `line_start (${next.lineStart}) > line_end (${next.lineEnd})` };
  }
  if (next.columnStart > next.columnEnd) {
    return { ok: false, error: `column_start (${next.columnStart}) > column_end (${next.columnEnd})` };
  }

  return { ok: true, viewport: next };
}

/**
 * 按 viewport 切分原始文本，返回带溢出提示的渲染文本。
 * 行：取 [lineStart, lineEnd)，总行数 > lineEnd 时尾部追加 `…(+N more lines)`。
 * 列：对每行 slice [columnStart, columnEnd)，首/尾越界加 `(+N before)…` / `…(+N more)`。空串原样返回。
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

/** 单行字符截断（字符级）：整行落在 columnStart 之前→空；首尾越界 marker 如实标出。 */
function sliceColumn(line: string, columnStart: number, columnEnd: number): string {
  const total = line.length;
  if (total === 0) return "";
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
