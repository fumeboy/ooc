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
} from "@ooc/core/types";
import {
  DEFAULT_VIEWPORT,
  applyViewport,
  mergeViewport,
  type Viewport,
} from "./viewport.js";
import { xmlElement, xmlText, truncateBytes, type XmlNode } from "@ooc/core/types/xml.js";
import type { ReadonlySelfProxy } from "@ooc/core/types";
import type { Data } from "../types.js";
import { OocObjectRef } from "@src/runtime/ooc-class.js";

/** Tuple-of-2 type guard（旧 _shared/utils 已退役，内联此处）。 */
function asTuple<T>(arr: readonly T[] | undefined): [T, T] | undefined {
  if (!arr || arr.length !== 2) return undefined;
  return [arr[0]!, arr[1]!];
}

const MAX_FILE_WINDOW_BYTES = 32768;

/** file 的**投影态**（与 Data 分离）：渲染视口 + 遗留 lines/columns 切片。 */
export interface FileWin {
  viewport: Viewport;
}

/** window method：精细化调整渲染视口（line/column）；返回新 win（不碰 Data）。 */
const setViewportMethod: WindowMethod<Data, FileWin> = {
  name: "set_viewport",
  description: "Precisely adjust the rendered viewport (line/column window) of this file.",
  schema: {
    line_start: { type: "number", description: "起始行（含；从0开始）" },
    line_end: { type: "number", description: "结束行（不含）" },
    column_start: { type: "number", description: "起始字符列（含；从0开始）" },
    column_end: { type: "number", description: "结束字符列（不含）" },
  },
  exec: (_ctx: ReadableContext, _self: ReadonlySelfProxy<Data>, before: FileWin, args: Record<string, unknown>): FileWin => {
    const merged = mergeViewport(before?.viewport ?? DEFAULT_VIEWPORT, args);
    if (!merged.ok) throw new Error(`[file.set_viewport] ${merged.error}`);
    return { ...before, viewport: merged.viewport };
  },
};

const readable: ReadableModule<Data, FileWin> = {
  readable: async (_ctx: ReadableContext, self: ReadonlySelfProxy<Data>, win: OocObjectRef<FileWin>) => {
    const viewport: Viewport = win.data?.viewport ?? DEFAULT_VIEWPORT;
    const children: XmlNode[] = [xmlElement("path", {}, [xmlText(self.data.path)])];
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

    try {
      const raw = await readFile(self.data.path, "utf8");
      let body = applyViewport(raw, viewport);
      children.push(xmlElement("content", {}, [xmlText(truncateBytes(body, MAX_FILE_WINDOW_BYTES))]));
    } catch (error) {
      children.push(xmlElement("error", {}, [xmlText((error as Error).message)]));
    }
    return { class: "file", content: children };
  },
  window: [
    {
      class: "file",
      object_methods: ["reload", "edit"],
      window_methods: [setViewportMethod],
    },
  ],
};

export default readable;
