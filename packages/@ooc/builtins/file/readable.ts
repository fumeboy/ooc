import { readFile } from "node:fs/promises";
import { type RenderContext } from "@ooc/core/extendable/_shared/registry.js";
import type { FileWindow } from "./types.js";
import {
  DEFAULT_VIEWPORT,
  applyViewport,
  type Viewport,
} from "@ooc/core/extendable/_shared/viewport.js";
import { xmlElement, xmlText, truncateBytes, type XmlNode } from "@ooc/core/thinkable/context/xml.js";

const MAX_FILE_WINDOW_BYTES = 32768;

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
  // 展示状态从 window.state 读，向后兼容旧平铺字段（H2/H3）。
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
