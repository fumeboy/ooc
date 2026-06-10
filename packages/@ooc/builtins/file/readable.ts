import { readFile } from "node:fs/promises";
import { builtinRegistry, type RenderContext } from "@ooc/core/extendable/_shared/registry.js";
import type { FileWindow } from "./types.js";
import {
  DEFAULT_VIEWPORT,
  applyViewport,
  windowSetViewport,
  hasAnyViewportField,
  type Viewport,
} from "@ooc/core/extendable/_shared/viewport.js";
import { xmlElement, xmlText, truncateBytes, type XmlNode } from "@ooc/core/_shared/types/xml.js";
import type {
  WindowMethod,
  WindowMethodExecutionContext,
  WindowMethodOutcome,
} from "@ooc/core/_shared/types/window-method.js";
import { asTuple } from "@ooc/builtins/_shared/executable/utils.js";

const MAX_FILE_WINDOW_BYTES = 32768;

const SET_RANGE_TIP = `file_window.set_range 调整文件的可见范围（行/列切片）—— 遗留命令，新代码用 set_viewport。
参数：lines: 可选 [start, end]；columns: 可选 [start, end]。`;

const SET_VIEWPORT_TIP = `file_window.set_viewport 精细化调整渲染窗口（行+列）。
默认 viewport = 0-200 行 × 0-200 字符。参数（全部可选，未传保留当前值）：
- line_start / line_end（从 0 开始，含头不含尾）
- column_start / column_end
必须是非负整数且 start <= end。viewport 只影响渲染，不影响 edit/reload。`;

function sliceByLinesColumns(
  raw: string,
  lines?: [number, number],
  columns?: [number, number],
): string {
  let body = raw;
  if (lines) {
    const arr = body.split("\n");
    const [start, end] = lines;
    body = arr.slice(start, end).join("\n");
  }
  if (columns) {
    const [start, end] = columns;
    body = body
      .split("\n")
      .map((line) => line.slice(start, end))
      .join("\n");
  }
  return body;
}

export async function readable(ctx: RenderContext): Promise<XmlNode[]> {
  const window = ctx.window as FileWindow;
  const children: XmlNode[] = [
    xmlElement("path", {}, [xmlText(window.path)]),
  ];
  const viewport: Viewport = window.state?.viewport ?? window.viewport ?? DEFAULT_VIEWPORT;
  const lines = window.state?.lines ?? window.lines;
  const columns = window.state?.columns ?? window.columns;
  children.push(
    xmlElement(
      "viewport",
      {
        line_start: String(viewport.lineStart),
        line_end: String(viewport.lineEnd),
        column_start: String(viewport.columnStart),
        column_end: String(viewport.columnEnd),
      },
      [],
    ),
  );
  if (lines) {
    children.push(xmlElement("lines", {}, [xmlText(`${lines[0]}-${lines[1]}`)]));
  }
  if (columns) {
    children.push(xmlElement("columns", {}, [xmlText(`${columns[0]}-${columns[1]}`)]));
  }
  try {
    const raw = await readFile(window.path, "utf8");
    let body = applyViewport(raw, viewport);
    if (lines || columns) {
      body = sliceByLinesColumns(body, lines, columns);
    }
    children.push(xmlElement("content", {}, [xmlText(truncateBytes(body, MAX_FILE_WINDOW_BYTES))]));
  } catch (error) {
    children.push(xmlElement("error", {}, [xmlText((error as Error).message)]));
  }
  return children;
}

const setRangeMethod: WindowMethod = {
  kind: "window",
  description: "Adjust the visible line/column slice of this file window (legacy; prefer set_viewport).",
  schema: {
    args: {
      lines: { type: "array", description: "可选 [start, end]，调整可见行范围" },
      columns: { type: "array", description: "可选 [start, end]，调整可见列范围" },
    },
  },
  onFormChange() {
    return { tip: SET_RANGE_TIP, intents: [{ name: "set_range" }], quick_exec_submit: true };
  },
  exec: (ctx) => fileWindowSetRange(ctx),
};

const setViewportMethod: WindowMethod = {
  kind: "window",
  description: "Precisely adjust the rendered viewport (line/column window) of this file.",
  schema: {
    args: {
      line_start: { type: "number", description: "起始行（含；从0开始）" },
      line_end: { type: "number", description: "结束行（不含）" },
      column_start: { type: "number", description: "起始字符列（含；从0开始）" },
      column_end: { type: "number", description: "结束字符列（不含）" },
    },
  },
  onFormChange(change, { args }) {
    let tip = SET_VIEWPORT_TIP;
    let quick_exec_submit = false;
    if (hasAnyViewportField(args)) {
      quick_exec_submit = true;
    } else {
      tip = SET_VIEWPORT_TIP + "\n\n至少传入 line_start / line_end / column_start / column_end 之一。";
    }
    return { tip, intents: [{ name: "set_viewport" }], quick_exec_submit };
  },
  exec: (ctx) => windowSetViewport(ctx, "file"),
};

export function fileWindowSetRange(ctx: WindowMethodExecutionContext): WindowMethodOutcome {
  const lines = asTuple(ctx.args.lines);
  const columns = asTuple(ctx.args.columns);
  return {
    ok: true,
    state: {
      ...ctx.windowState,
      lines: lines ?? ctx.windowState.lines,
      columns: columns ?? ctx.windowState.columns,
    },
  };
}

async function compressFileWindow(
  ctx: RenderContext,
  level: 1 | 2,
): Promise<XmlNode[]> {
  const window = ctx.window as FileWindow;
  const attrs: Record<string, string> = { path: window.path };
  let errorMsg: string | undefined;
  try {
    const raw = await readFile(window.path, "utf8");
    const totalLines = raw === "" ? 0 : raw.split("\n").length;
    attrs.total_lines = String(totalLines);
  } catch (err) {
    errorMsg = (err as Error).message;
  }
  const lines = window.state?.lines ?? window.lines;
  if (level === 1 && lines) {
    attrs.read_range = `${lines[0]}-${lines[1]}`;
  }
  const children: XmlNode[] = [xmlElement("file", attrs)];
  if (errorMsg) {
    children.push(xmlElement("error", {}, [xmlText(errorMsg)]));
  }
  children.push(
    xmlElement("compressed", {
      level: String(level),
      hint: "exec(window_id, 'expand') to restore",
    }),
  );
  return children;
}

builtinRegistry.registerReadable("file", {
  windowMethods: {
    set_range: setRangeMethod,
    set_viewport: setViewportMethod,
  },
  readable,
  compressView: compressFileWindow,
});
