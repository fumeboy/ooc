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
import { xmlElement, xmlText, truncateBytes, type XmlNode } from "@ooc/core/thinkable/context/xml.js";
import type {
  WindowMethod,
  WindowMethodExecutionContext,
  WindowMethodOutcome,
} from "@ooc/core/_shared/types/window-method.js";
import type { MethodExecWindow } from "@ooc/core/executable/windows/method_exec/types.js";
import { buildGuidanceWindows } from "@ooc/builtins/_shared/executable/guidance.js";
import { isString, emptyIntent } from "@ooc/builtins/_shared/executable/utils.js";

const MAX_FILE_WINDOW_BYTES = 32768;

const FILE_WINDOW_SET_RANGE_BASIC = "internal/windows/file/set_range/basic";
const FILE_WINDOW_SET_VIEWPORT_BASIC = "internal/windows/file/set_viewport/basic";
const FILE_WINDOW_SET_VIEWPORT_INPUT = "internal/windows/file/set_viewport/input";

const SET_RANGE_KNOWLEDGE = `
file_window.set_range 调整文件的可见范围（行/列切片）—— **遗留命令，新代码用 set_viewport**。

参数：
- lines: 可选 [start, end]
- columns: 可选 [start, end]

例：refine(form, args={ lines: [0, 200] }) → 仅展示前 200 行
`.trim();

const SET_VIEWPORT_KNOWLEDGE = `
file_window.set_viewport 精细化调整渲染窗口大小（行+列）。

打开 file_window 时默认 viewport = { line_start: 0, line_end: 200, column_start: 0, column_end: 200 }
（即前 200 行 × 每行前 200 个字符）。需要看更多内容时显式扩窗。

参数（**全部可选**，未传字段保留当前值）：
- line_start: 起始行（含；从 0 开始）
- line_end:   结束行（不含）
- column_start: 起始字符列（含；从 0 开始）
- column_end:   结束字符列（不含）

约束（fail-loud）：
- 全部必须是**非负整数**
- line_start <= line_end
- column_start <= column_end

渲染：超 line_end 标 \`…(+N more lines)\`；行长 > column_end 标 \`…(+N more)\`；
column_start > 0 行首标 \`(+N before)…\`。

**注意**：viewport 只影响**渲染**给 LLM 的内容；edit / reload 等命令仍基于文件完整内容。
想做精确文本替换时不需要先扩 viewport——edit 的 old/new 匹配看的是磁盘文件全文。

例：
- refine(form, args={ line_end: 1000 }) → 一次看前 1000 行
- refine(form, args={ line_start: 200, line_end: 400 }) → 看 200-400 行
- refine(form, args={ column_end: 500 }) → 把每行可见宽度扩到 500 字符
`.trim();

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

/** 解析 [number, number] 元组；用于 set_range（window method）与 open_file constructor 的 lines/columns。 */
export function asTuple(value: unknown): [number, number] | undefined {
  if (
    Array.isArray(value) &&
    value.length === 2 &&
    typeof value[0] === "number" &&
    typeof value[1] === "number"
  ) {
    return [value[0], value[1]];
  }
  return undefined;
}

const setRangeMethod: WindowMethod = {
  kind: "window",
  paths: ["set_range"],
  schema: {
    args: {
      lines: { type: "array", description: "可选 [start, end]，调整可见行范围" },
      columns: { type: "array", description: "可选 [start, end]，调整可见列范围" },
    },
  },
  intent: emptyIntent,
  onFormChange: (change, { form }) => {
    if (change.kind === "status_changed" && change.to !== "open") return [];
    return buildGuidanceWindows(form, { [FILE_WINDOW_SET_RANGE_BASIC]: SET_RANGE_KNOWLEDGE });
  },
  exec: (ctx) => fileWindowSetRange(ctx),
};

const setViewportMethod: WindowMethod = {
  kind: "window",
  paths: ["set_viewport"],
  schema: {
    args: {
      line_start: { type: "number", description: "起始行（含；从0开始）" },
      line_end: { type: "number", description: "结束行（不含）" },
      column_start: { type: "number", description: "起始字符列（含；从0开始）" },
      column_end: { type: "number", description: "结束字符列（不含）" },
    },
  },
  intent: emptyIntent,
  onFormChange: (change, { form }) => {
    if (change.kind === "status_changed" && change.to !== "open") return [];
    // batch C narrowing(N1): onFormChange 的 form 契约层是 base，narrow 回 MethodExecWindow 取 accumulatedArgs。
    const args = change.kind === "args_refined" ? change.args : (form as MethodExecWindow).accumulatedArgs;
    const formStatus = form.status;
    const entries: Record<string, string> = {
      [FILE_WINDOW_SET_VIEWPORT_BASIC]: SET_VIEWPORT_KNOWLEDGE,
    };
    if (formStatus === "open" && !hasAnyViewportField(args)) {
      entries[FILE_WINDOW_SET_VIEWPORT_INPUT] =
        "set_viewport 至少需要传入 line_start / line_end / column_start / column_end 之一。\n" +
        "未传字段保留当前值。请 refine 补齐后 submit。";
    }
    return buildGuidanceWindows(form, entries);
  },
  exec: (ctx) => windowSetViewport(ctx, "file"),
};

/**
 * set_range 的 window method 执行体（控制展示，归 readable）。
 *
 * 写 state.lines / state.columns（第二阶段切片，与 viewport 复合、互不覆盖）。
 * 返回新 WindowDisplayState（immutable）——manager 写回 window.state，不碰业务数据。
 */
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

/**
 * file_window 的 compressView hook（design: docs/2026-05-25-context-compression-design.md §4.1）。
 *
 * - Level 1 (folded):  `<file path=... total_lines=N read_range="a-b"?/>` — 还保留"读哪段"
 * - Level 2 (snapshot): `<file path=... total_lines=N/>` — 不暴露 read_range
 *
 * total_lines 通过实时读文件统计;读取失败则省略 total_lines 属性并附 `<error>`。
 * read_range 仅在 window.lines 存在时输出(没有 lines 即整文件读)。
 */
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
  // H2: 展示字段从 window.state 读，向后兼容旧平铺字段。
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

// readable 维度自注册（readable + window methods set_range/set_viewport + compressView）。
builtinRegistry.registerReadable("file", {
  windowMethods: {
    set_range: setRangeMethod,
    set_viewport: setViewportMethod,
  },
  readable,
  compressView: compressFileWindow,
});
