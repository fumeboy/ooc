/**
 * file —— readable 维度（投影成 context window + window method）。
 *
 * - readable：node:fs 读 self.path → 按投影态 win.viewport 行/列切片（applyViewport）+ 可选 set_range
 *   的 lines/columns 二次切片 + 32KB 兜底截断；class 固定 "file"。
 * - window method set_viewport：精细化调整渲染窗口（line/column）；写 win.viewport（复用 mergeViewport）。
 * - window method set_range：遗留命令，调整 lines/columns 切片；写 win.lines / win.columns。
 *
 * window method 只动投影态 win（返回新 win，不可变），不碰 Data、不副作用。与 executable 维度
 * （object method reload/edit/close，在 ../executable/index.ts）物理分离。
 */

import { readFile } from "node:fs/promises";
import type {
  ReadableContext,
  WindowMethod,
  ReadableModule,
} from "@ooc/core/readable/contract.js";
import {
  DEFAULT_VIEWPORT,
  applyViewport,
  mergeViewport,
  type Viewport,
} from "@ooc/core/executable/windows/_shared/viewport.js";
import { xmlElement, xmlText, truncateBytes, type XmlNode } from "@ooc/core/_shared/types/xml.js";
import { asTuple } from "@ooc/builtins/_shared/executable/utils.js";
import type { Data } from "../types.js";

const MAX_FILE_WINDOW_BYTES = 32768;

/** file 的**投影态**（与 Data 分离）：渲染视口 + 遗留 lines/columns 切片。 */
export interface FileWin {
  viewport: Viewport;
  lines?: [number, number];
  columns?: [number, number];
}

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

/** window method：精细化调整渲染视口（line/column）；返回新 win（不碰 Data）。 */
const setViewportMethod: WindowMethod<Data, FileWin> = {
  name: "set_viewport",
  description: "Precisely adjust the rendered viewport (line/column window) of this file.",
  schema: {
    args: {
      line_start: { type: "number", description: "起始行（含；从0开始）" },
      line_end: { type: "number", description: "结束行（不含）" },
      column_start: { type: "number", description: "起始字符列（含；从0开始）" },
      column_end: { type: "number", description: "结束字符列（不含）" },
    },
  },
  exec: (_ctx: ReadableContext, _self: Data, before: FileWin, args: Record<string, unknown>): FileWin => {
    const merged = mergeViewport(before?.viewport ?? DEFAULT_VIEWPORT, args);
    if (!merged.ok) throw new Error(`[file.set_viewport] ${merged.error}`);
    return { ...before, viewport: merged.viewport };
  },
};

/** window method（遗留）：调整可见行/列切片；返回新 win。新代码用 set_viewport。 */
const setRangeMethod: WindowMethod<Data, FileWin> = {
  name: "set_range",
  description: "Adjust the visible line/column slice of this file window (legacy; prefer set_viewport).",
  schema: {
    args: {
      lines: { type: "array", description: "可选 [start, end]，调整可见行范围" },
      columns: { type: "array", description: "可选 [start, end]，调整可见列范围" },
    },
  },
  exec: (_ctx: ReadableContext, _self: Data, before: FileWin, args: Record<string, unknown>): FileWin => {
    const lines = asTuple(args.lines);
    const columns = asTuple(args.columns);
    return {
      ...before,
      lines: lines ?? before?.lines,
      columns: columns ?? before?.columns,
    };
  },
};

const readable: ReadableModule<Data, FileWin> = {
  readable: async (_ctx: ReadableContext, self: Data, win: FileWin) => {
    const viewport: Viewport = win?.viewport ?? DEFAULT_VIEWPORT;
    const lines = win?.lines;
    const columns = win?.columns;
    const children: XmlNode[] = [xmlElement("path", {}, [xmlText(self.path)])];
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
      const raw = await readFile(self.path, "utf8");
      let body = applyViewport(raw, viewport);
      if (lines || columns) {
        body = sliceByLinesColumns(body, lines, columns);
      }
      children.push(xmlElement("content", {}, [xmlText(truncateBytes(body, MAX_FILE_WINDOW_BYTES))]));
    } catch (error) {
      children.push(xmlElement("error", {}, [xmlText((error as Error).message)]));
    }
    return { class: "file", content: children };
  },
  window: [
    {
      class: "file",
      object_methods: ["reload", "edit", "close"],
      window_methods: [setViewportMethod, setRangeMethod],
    },
  ],
};

export default readable;
