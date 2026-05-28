/**
 * file_window — 在 context 中显示某个文件的内容窗口。
 *
 * - 由 root.open_file / root.write_file 创建（args: path, lines?, columns?）
 *   open 时自动填默认 viewport = 0-200 行 / 0-200 字符（DEFAULT_VIEWPORT）
 * - 注册的 command：set_viewport / set_range / reload / edit / close
 *   - **set_viewport（推荐）**：精细化调整渲染窗口（line_start/line_end/column_start/column_end）
 *   - set_range：遗留命令，调整 lines / columns 切片（保留向后兼容）
 *   - reload：重新读文件（render 层每轮都会读，所以 reload 主要是语义提示）
 *   - edit：基于"oldString → newString"做精确唯一替换；支持 array 形式做 atomic 多点修改
 *   - close：释放 window
 * - 渲染：viewport 控制行/列切片 + overflow marker；32KB 兜底截断
 *
 * 详见 meta/object.doc.ts:executable.context_window.patches.viewport_protocol。
 */

import { readFile, writeFile } from "node:fs/promises";

import type {
  CommandExecutionContext,
  CommandKnowledgeEntries,
  CommandTableEntry,
} from "../_shared/command-types.js";
import { registerWindowType, type RenderContext } from "../_shared/registry.js";
import type { FileWindow } from "../_shared/types.js";
import {
  DEFAULT_VIEWPORT,
  applyViewport,
  executeWindowSetViewport,
  hasAnyViewportField,
  type Viewport,
} from "../_shared/viewport.js";
import { xmlElement, xmlText, truncateBytes, type XmlNode } from "../../../thinkable/context/xml.js";

const MAX_FILE_WINDOW_BYTES = 32768;

const FILE_WINDOW_SET_RANGE_BASIC = "internal/windows/file/set_range/basic";
const FILE_WINDOW_SET_VIEWPORT_BASIC = "internal/windows/file/set_viewport/basic";
const FILE_WINDOW_SET_VIEWPORT_INPUT = "internal/windows/file/set_viewport/input";
const FILE_WINDOW_RELOAD_BASIC = "internal/windows/file/reload/basic";
const FILE_WINDOW_CLOSE_BASIC = "internal/windows/file/close/basic";
const FILE_WINDOW_EDIT_BASIC = "internal/windows/file/edit/basic";
const FILE_WINDOW_EDIT_INPUT = "internal/windows/file/edit/input";

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

const RELOAD_KNOWLEDGE = `
file_window.reload 强制下一轮重新读文件。当前 render 每轮都重读一次，本命令主要是语义提示。
`.trim();

const CLOSE_KNOWLEDGE = `
file_window.close 释放 window；不影响磁盘上的文件本身。
`.trim();

const EDIT_KNOWLEDGE = `
file_window.edit 在 file_window 对应的文件上做"精确唯一字符串替换"。这是 OOC 修改已有文件
的**首选方式**——比 program(shell) + sed/awk 更安全（不需要担心转义）、更可见（修改在
file_window 上下次 render 自然出现）、并且支持原子多点修改。

它也是**大文件增量补全的搭档**：当 write_file 先写出骨架（结构 + 各 section 空壳/占位）后，
用 edit 把每个空壳逐段替换成真实内容——分段填充，每轮输出短，避免单轮超长生成超时。

## 调用形式

### 单次替换

\`\`\`
open(parent_window_id="<file_window_id>", command="edit",
     title="rename helper",
     args={ old: "function helperA(", new: "function helperB(" })
\`\`\`

### 一次提交多点替换（MultiEdit 风格，atomic-or-fail）

\`\`\`
open(parent_window_id="<file_window_id>", command="edit",
     title="batch rename",
     args={ edits: [
       { old: "function helperA(", new: "function helperB(" },
       { old: "/* old comment */",  new: "/* new comment */" }
     ]})
\`\`\`

数组形式按顺序应用：edit[i] 的 \`old\` 必须在 **应用完前 i-1 项之后** 的当前缓冲区里
**正好出现一次**。任意一项失败则整组不写盘。

## 规则

- \`old\` 必须在文件中**正好出现一次**（精确唯一）；如果出现 0 次或多次，整次 edit
  失败，文件不变，错误信息会标明：哪个文件、哪条 edit（数组下标）、原因（not found / matches N times）
- \`new\` 可以是空字符串（即"删除 old"）；也可以与 old 完全相同（no-op，但仍判定为成功）
- 修改立即写入磁盘；不存在"草稿/save"两阶段
- 想"扩大上下文以避免歧义"时，把 \`old\` 写得更长（含前后多行）即可

## edit 失败后的正确反应（**不要退化**）

收到 \`matches N times\` 错误 → 直接的应对是**把 \`old\` 写得更长**，包含前后几行
让它在全文中唯一，再 edit 一次。例：原 \`old: "count = 0"\` 全文 3 处 → 改成
\`old: "// 第一处计数初始化\\nconst count = 0"\` 只剩 1 处。

收到 \`not found\` 错误 → 用 file_window.reload 或重新读 file_window 当前可见内容
确认实际字符串（注意空白、引号、行尾），再 edit。

**不要**因为 edit 失败就改用 write_file 整文件覆盖——那等于放弃了精确性，重发整文件
你也可能漏字符、改错位；本来一个"扩大 old 上下文"就能解决。

## 与 shell / write_file 改文件的对比

- 不要再用 \`program(language="shell", code="sed -i ...")\` 改文件——容易踩转义陷阱、丢失
  file_window 的可见性、并且无法表达 atomic 多点修改
- 不要用 \`write_file\` 做"修改局部"——write_file 是整文件覆盖语义，详见 root.write_file 的 KNOWLEDGE
`.trim();

const setRangeCommand: CommandTableEntry = {
  paths: ["set_range"],
  match: () => ["set_range"],
  knowledge: (): CommandKnowledgeEntries => ({ [FILE_WINDOW_SET_RANGE_BASIC]: SET_RANGE_KNOWLEDGE }),
  exec: (ctx) => executeFileWindowSetRange(ctx),
};

const setViewportCommand: CommandTableEntry = {
  paths: ["set_viewport"],
  match: () => ["set_viewport"],
  knowledge: (args, formStatus): CommandKnowledgeEntries => {
    const entries: CommandKnowledgeEntries = {
      [FILE_WINDOW_SET_VIEWPORT_BASIC]: SET_VIEWPORT_KNOWLEDGE,
    };
    if (formStatus === "open" && !hasAnyViewportField(args)) {
      entries[FILE_WINDOW_SET_VIEWPORT_INPUT] =
        "set_viewport 至少需要传入 line_start / line_end / column_start / column_end 之一。\n" +
        "未传字段保留当前值。请 refine 补齐后 submit。";
    }
    return entries;
  },
  exec: (ctx) => executeWindowSetViewport(ctx, "file"),
};

const reloadCommand: CommandTableEntry = {
  paths: ["reload"],
  match: () => ["reload"],
  knowledge: (): CommandKnowledgeEntries => ({ [FILE_WINDOW_RELOAD_BASIC]: RELOAD_KNOWLEDGE }),
  exec: () => undefined, // render 层每轮都会重读
};

const closeCommand: CommandTableEntry = {
  paths: ["close"],
  match: () => ["close"],
  knowledge: (): CommandKnowledgeEntries => ({ [FILE_WINDOW_CLOSE_BASIC]: CLOSE_KNOWLEDGE }),
  exec: () => undefined,
};

const editCommand: CommandTableEntry = {
  paths: ["edit"],
  match: () => ["edit"],
  knowledge: (args, formStatus): CommandKnowledgeEntries => {
    const entries: CommandKnowledgeEntries = { [FILE_WINDOW_EDIT_BASIC]: EDIT_KNOWLEDGE };
    if (formStatus !== "open") return entries;
    const single = isString(args.old) && isString(args.new);
    const batch = Array.isArray(args.edits) && args.edits.length > 0;
    if (!single && !batch) {
      entries[FILE_WINDOW_EDIT_INPUT] =
        "file_window.edit 需要 args={ old, new } 或 args={ edits: [{old, new}, ...] }；二者择一。";
    }
    return entries;
  },
  exec: (ctx) => executeFileWindowEdit(ctx),
};

function asTuple(value: unknown): [number, number] | undefined {
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

function isString(value: unknown): value is string {
  return typeof value === "string";
}

interface EditPair {
  old: string;
  new: string;
}

/**
 * 解析 edit args 为 EditPair[]。
 * - { old, new } → [{old, new}]
 * - { edits: [{old, new}, ...] } → 原样
 * - 其它 → undefined
 */
function parseEdits(args: Record<string, unknown>): EditPair[] | undefined {
  if (isString(args.old) && isString(args.new)) {
    return [{ old: args.old, new: args.new }];
  }
  if (Array.isArray(args.edits)) {
    const out: EditPair[] = [];
    for (let i = 0; i < args.edits.length; i += 1) {
      const item = args.edits[i] as Record<string, unknown> | undefined;
      if (!item || !isString(item.old) || !isString(item.new)) return undefined;
      out.push({ old: item.old, new: item.new });
    }
    return out.length > 0 ? out : undefined;
  }
  return undefined;
}

/**
 * 把所有 edit 应用到 buffer。
 * 任何一条失败立即返回错误，不修改磁盘。
 *
 * 失败原因：
 * - "not found" — old 在当前 buffer 里完全不存在
 * - "matches N times" — old 在当前 buffer 里出现 N 次（>1）
 *
 * 注意：检查"正好出现一次"基于**当前 buffer**（已应用前面的 edit），而不是原始文件。
 * 这是 Claude Code MultiEdit 的语义。
 */
function applyEdits(
  initial: string,
  edits: EditPair[],
): { ok: true; result: string } | { ok: false; error: string } {
  let buffer = initial;
  for (let i = 0; i < edits.length; i += 1) {
    const e = edits[i]!;
    // 计数 old 出现次数
    let count = 0;
    let pos = 0;
    while (true) {
      const idx = buffer.indexOf(e.old, pos);
      if (idx === -1) break;
      count += 1;
      pos = idx + Math.max(e.old.length, 1);
      if (count > 1) break; // 早退；reportable
    }
    if (count === 0) {
      return { ok: false, error: `edit #${i}: oldString not found` };
    }
    if (count > 1) {
      // 走完整 count 用于错误信息
      let total = 0;
      let p2 = 0;
      while (true) {
        const idx = buffer.indexOf(e.old, p2);
        if (idx === -1) break;
        total += 1;
        p2 = idx + Math.max(e.old.length, 1);
      }
      return { ok: false, error: `edit #${i}: oldString matches ${total} times (must match exactly once)` };
    }
    // count === 1
    buffer = buffer.replace(e.old, e.new);
  }
  return { ok: true, result: buffer };
}

/** 把 set_range 的 args 落到目标 file_window；通过 manager 操作以保证 toData() 写回。 */
export async function executeFileWindowSetRange(
  ctx: CommandExecutionContext,
): Promise<string | undefined> {
  const window = ctx.parentWindow;
  if (!window || window.type !== "file") {
    return "[file_window.set_range] 未挂载在 file_window 上。";
  }
  const lines = asTuple(ctx.args.lines);
  const columns = asTuple(ctx.args.columns);
  const next: FileWindow = {
    ...window,
    lines: lines ?? window.lines,
    columns: columns ?? window.columns,
  };
  Object.assign(window, next);
  return undefined;
}

/**
 * file_window.edit：精确唯一替换。
 *
 * 行为：
 * - 必须挂在 file_window 上
 * - args 必须是 { old, new } 或 { edits: [{old, new}, ...] }
 * - 应用规则见 EDIT_KNOWLEDGE / applyEdits
 * - 成功：把新内容写回 window.path；返回 undefined
 * - 失败：不写盘；返回错误字符串（前缀 [file_window.edit]，便于 LLM 解析）
 */
export async function executeFileWindowEdit(
  ctx: CommandExecutionContext,
): Promise<string | undefined> {
  const window = ctx.parentWindow;
  if (!window || window.type !== "file") {
    return "[file_window.edit] 未挂载在 file_window 上。";
  }
  const edits = parseEdits(ctx.args);
  if (!edits) {
    return "[file_window.edit] 缺少 args={ old, new } 或 args={ edits: [{old, new}, ...] }。";
  }

  let buffer: string;
  try {
    buffer = await readFile(window.path, "utf8");
  } catch (err) {
    return `[file_window.edit] 读取 ${window.path} 失败：${(err as Error).message}`;
  }

  const result = applyEdits(buffer, edits);
  if (!result.ok) {
    return `[file_window.edit] ${window.path}: ${result.error}`;
  }

  try {
    await writeFile(window.path, result.result, "utf8");
  } catch (err) {
    return `[file_window.edit] 写回 ${window.path} 失败：${(err as Error).message}`;
  }

  return undefined;
}

/** 按行/列范围切片文件正文；range 缺失则原样返回。 */
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

/** file_window 的 renderXml hook：path + viewport + 文件正文（按 viewport 切片）。 */
async function renderFileWindow(ctx: RenderContext): Promise<XmlNode[]> {
  const window = ctx.window as FileWindow;
  const children: XmlNode[] = [
    xmlElement("path", {}, [xmlText(window.path)]),
  ];
  const viewport: Viewport = window.viewport ?? DEFAULT_VIEWPORT;
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
  // 兼容旧 lines/columns（遗留 set_range 路径）
  if (window.lines) {
    children.push(xmlElement("lines", {}, [xmlText(`${window.lines[0]}-${window.lines[1]}`)]));
  }
  if (window.columns) {
    children.push(xmlElement("columns", {}, [xmlText(`${window.columns[0]}-${window.columns[1]}`)]));
  }
  try {
    const raw = await readFile(window.path, "utf8");
    // 优先按 viewport 切；如有遗留 lines/columns 在 viewport 之后再叠加（向后兼容）
    let body = applyViewport(raw, viewport);
    if (window.lines || window.columns) {
      body = sliceByLinesColumns(body, window.lines, window.columns);
    }
    children.push(xmlElement("content", {}, [xmlText(truncateBytes(body, MAX_FILE_WINDOW_BYTES))]));
  } catch (error) {
    children.push(xmlElement("error", {}, [xmlText((error as Error).message)]));
  }
  return children;
}

/**
 * file_window 的 compressView hook（design: docs/2026-05-25-context-compression-design.md §4.1）。
 *
 * - Level 1 (folded):  `<file path=... total_lines=N read_range="a-b"?/>` — 还保留"读哪段"
 * - Level 2 (snapshot): `<file path=... total_lines=N/>` — 不暴露 read_range
 *
 * total_lines 通过实时读文件统计;读取失败则省略 total_lines 属性并附 `<error>`。
 * read_range 仅在 window.lines 存在时输出(没有 lines 即整文件读)。
 *
 * 末尾追加 `<compressed level=N hint="exec(window_id, 'expand') to restore"/>` 元节点,
 * 让 LLM 知道当前处于压缩态。
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
  if (level === 1 && window.lines) {
    attrs.read_range = `${window.lines[0]}-${window.lines[1]}`;
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

registerWindowType("file", {
  commands: {
    set_range: setRangeCommand,
    set_viewport: setViewportCommand,
    reload: reloadCommand,
    edit: editCommand,
    close: closeCommand,
  },
  renderXml: renderFileWindow,
  compressView: compressFileWindow,
});
