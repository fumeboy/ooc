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

import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type {
  MethodExecutionContext,
  ObjectMethod,
} from "@ooc/core/extendable/_shared/method-types.js";
import { builtinRegistry, type RenderContext } from "@ooc/core/extendable/_shared/registry.js";
import type { FileWindow } from "../types.js";
import {
  DEFAULT_VIEWPORT,
  applyViewport,
  executeWindowSetViewport,
  hasAnyViewportField,
  type Viewport,
} from "@ooc/core/extendable/_shared/viewport.js";
import {
  ROOT_WINDOW_ID,
  generateWindowId,
} from "@ooc/core/extendable/_shared/types.js";
import {
  classifyStonesPath,
  resolveSessionPath,
} from "@ooc/core/extendable/_shared/session-path.js";
import { versionedStoneWrite } from "@ooc/core/persistable/index.js";
import { xmlElement, xmlText, truncateBytes, type XmlNode } from "@ooc/core/thinkable/context/xml.js";
import { readable } from "../readable.js";

import type { Intent, MethodCallSchema } from "@ooc/core/thinkable/context/intent.js";
import type { ContextWindow } from "@ooc/core/executable/windows/_shared/types.js";
import type { MethodExecWindow } from "@ooc/core/executable/windows/method_exec/types.js";
import { buildGuidanceWindows } from "@ooc/builtins/_shared/executable/guidance.js";
import { isString, basenameOfPath, emptyIntent } from "@ooc/builtins/_shared/executable/utils.js";


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

const setRangeCommand: ObjectMethod = {
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
  exec: (ctx) => executeFileWindowSetRange(ctx),
};

const setViewportCommand: ObjectMethod = {
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
  exec: (ctx) => executeWindowSetViewport(ctx, "file"),
};

const reloadCommand: ObjectMethod = {
  paths: ["reload"],
  intent: emptyIntent,
  onFormChange: (change, { form }) => {
    if (change.kind === "status_changed" && change.to !== "open") return [];
    return buildGuidanceWindows(form, { [FILE_WINDOW_RELOAD_BASIC]: RELOAD_KNOWLEDGE });
  },
  exec: () => undefined, // render 层每轮都会重读
};

const closeCommand: ObjectMethod = {
  paths: ["close"],
  intent: emptyIntent,
  onFormChange: (change, { form }) => {
    if (change.kind === "status_changed" && change.to !== "open") return [];
    return buildGuidanceWindows(form, { [FILE_WINDOW_CLOSE_BASIC]: CLOSE_KNOWLEDGE });
  },
  exec: () => undefined,
};

const editCommand: ObjectMethod = {
  paths: ["edit"],
  schema: {
    args: {
      old: { type: "string", description: "要替换的旧字符串（必须在文件中正好出现一次）" },
      new: { type: "string", description: "替换后的新字符串" },
      edits: { type: "array", description: "批量替换 [{old, new}, ...]，与 old/new 二选一" },
    },
  },
  intent: emptyIntent,
  onFormChange: (change, { form }) => {
    if (change.kind === "status_changed" && change.to !== "open") return [];
    // batch C narrowing(N1): onFormChange 的 form 契约层是 base，narrow 回 MethodExecWindow 取 accumulatedArgs。
    const args = change.kind === "args_refined" ? change.args : (form as MethodExecWindow).accumulatedArgs;
    const formStatus = form.status;
    const entries: Record<string, string> = { [FILE_WINDOW_EDIT_BASIC]: EDIT_KNOWLEDGE };
    if (formStatus !== "open") return buildGuidanceWindows(form, entries);
    const single = isString(args.old) && isString(args.new);
    const batch = Array.isArray(args.edits) && args.edits.length > 0;
    if (!single && !batch) {
      entries[FILE_WINDOW_EDIT_INPUT] =
        "file_window.edit 需要 args={ old, new } 或 args={ edits: [{old, new}, ...] }；二者择一。";
    }
    return buildGuidanceWindows(form, entries);
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
  ctx: MethodExecutionContext,
): Promise<string | undefined> {
  // P6.§3: manager 在 dispatch 阶段已保证 self.type === "file"，method 体不再 re-check。
  const window = ctx.self as FileWindow;
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
  ctx: MethodExecutionContext,
): Promise<string | undefined> {
  // P6.§3: manager 在 dispatch 阶段已保证 self.type === "file"，method 体不再 re-check。
  const window = ctx.self as FileWindow;
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
  if (result.ok === false) {
    return `[file_window.edit] ${window.path}: ${result.error}`;
  }

  try {
    await writeFile(window.path, result.result, "utf8");
  } catch (err) {
    return `[file_window.edit] 写回 ${window.path} 失败：${(err as Error).message}`;
  }

  return undefined;
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

// ─────────────────────────── constructor (P6.§4) ────────────────────────────

/**
 * P6.§4 (2026-06-02): Constructor for the `file` Object type.
 *
 * Encapsulates the construction of a `file_window` ContextWindow. The root
 * methods `open_file` and `write_file` (in `@ooc/builtins/root`) become thin
 * delegators that call this constructor via `lookupConstructor("file")`.
 *
 * Two `paths` are exposed because two root methods construct file windows:
 *  - `open_file` — read-only window pointing at an existing file (path / lines / columns)
 *  - `write_file` — write content to disk (with optional stone versioning) then spawn a window
 *
 * Dispatch on `ctx.form?.command`:
 *  - command === "write_file": validate path + content, perform write (versioned for stones,
 *    direct for non-stone), then construct a FileWindow.
 *  - command === "open_file" (or anything else): validate path exists, then construct.
 *
 * Validation rules (per root method):
 *  - open_file: `path` is a non-empty string; resolved against session baseDir; must exist.
 *  - write_file: `path` is a non-empty string; `content` is a string (may be empty);
 *    if path falls inside a stone-object subtree, route through versionedStoneWrite;
 *    workspace-level packages/ paths are forbidden.
 *
 * Returns: `{ ok: true, object: FileWindow }` on success — manager.submit's §2 branch
 * inserts the window. Failure → `{ ok: false, error }` (form stays in failed state).
 */
const fileConstructor: ObjectMethod = {
  kind: "constructor",
  paths: ["open_file", "write_file"],
  schema: {
    args: {
      path: { type: "string", required: true, description: "文件路径（相对 session baseDir）" },
      content: { type: "string", description: "要写入的文件内容；提供时走 write_file 分支" },
      lines: { type: "array", description: "可选 [start, end]，open_file 时指定可见行范围" },
      columns: { type: "array", description: "可选 [start, end]，open_file 时指定可见列范围" },
    },
  },
  intent: (args) => {
    if (typeof args.content === "string") return [{ name: "write_file" }];
    return [{ name: "open_file" }];
  },
  permission: () => "allow",
  exec: async (ctx) => {
    const thread = ctx.thread;
    if (!thread) return { ok: false, error: "[file] 缺少 thread context。" };
    // batch C narrowing(N1): ctx.form 契约层是 base ContextWindow，narrow 回 MethodExecWindow 读 command。
    const command = (ctx.form as MethodExecWindow | undefined)?.command ?? "open_file";

    if (command === "write_file") {
      const rawPath = isString(ctx.args.path) ? ctx.args.path : "";
      if (!rawPath) return { ok: false, error: "[write_file] 缺少 path 参数。" };
      const content = ctx.args.content;
      if (typeof content !== "string") {
        return { ok: false, error: "[write_file] 缺少 content 参数（应是字符串，可为空）。" };
      }
      const path = resolveSessionPath(thread, rawPath);
      const baseDir = thread.persistence?.baseDir;
      const stoneClass = classifyStonesPath(path, baseDir, undefined);

      // 历史 write_file 的 preExisted hint：覆盖已有文件时给一条提示，把"修改局部用 edit"
      // 的规则推到 LLM 眼前。constructor outcome 不能返回 result 字符串（已被 manager 改成
      // "Constructed file window <id>"），所以改写为 thread 事件 inject。
      let preExisted = false;
      if (stoneClass.kind !== "stone-object" && stoneClass.kind !== "stones-world") {
        try {
          const s = await stat(path);
          preExisted = s.isFile();
        } catch {
          /* 不存在 → 新建 */
        }
      }

      if (stoneClass.kind === "stone-object") {
        const authorObjectId = thread.persistence?.objectId;
        if (!baseDir || !authorObjectId) {
          return {
            ok: false,
            error:
              `[write_file] 路径落在 packages 自治区 (${path}) 需走 versioning，但当前 thread ` +
              `缺少 ${!baseDir ? "persistence.baseDir" : "persistence.objectId"}，无法版本化写入。`,
          };
        }
        const versioned = await versionedStoneWrite({
          baseDir,
          authorObjectId,
          intent: `write_file ${stoneClass.relInObjects}`,
          write: async (wt) => {
            const target = join(wt.path, stoneClass.relInObjects);
            await mkdir(dirname(target), { recursive: true });
            await writeFile(target, content, "utf8");
          },
        });
        if (!versioned.ok) {
          return { ok: false, error: `[write_file] versioning 写入失败 (${versioned.code})：${versioned.message}` };
        }
        // versioning 信息走 thread.events.inject（constructor outcome 不能返 result 字符串）
        const scopeNote = versioned.merged
          ? `已 commit 并合并（commit ${versioned.commitSha.slice(0, 8)}）`
          : `改动越出你的自治区，已开 PR-Issue #${versioned.prIssueId} 等 Supervisor 评审（暂未合并）`;
        if (thread.events) {
          thread.events.push({
            category: "context_change",
            kind: "inject",
            text: `[write_file] ${path} 经 versioning ${scopeNote}。`,
          });
        }
      } else if (stoneClass.kind === "stones-world") {
        return {
          ok: false,
          error:
            `[write_file] 路径 ${path} 落在 packages/ 根但不在某个 Object 的 ` +
            `子目录内（workspace-level 资源）。这类资源不能通过 write_file 修改。`,
        };
      } else {
        try {
          await mkdir(dirname(path), { recursive: true });
          await writeFile(path, content, "utf8");
        } catch (err) {
          return { ok: false, error: `[write_file] 写入 ${path} 失败：${(err as Error).message}` };
        }
      }
      const fileWindow: FileWindow = {
        id: generateWindowId("file"),
        type: "file",
        parentWindowId: ROOT_WINDOW_ID,
        title: basenameOfPath(path),
        status: "open",
        createdAt: Date.now(),
        path,
      };
      if (preExisted) {
        if (thread.events) {
          thread.events.push({
            category: "context_change",
            kind: "inject",
            text:
              `[write_file hint] 你刚整文件覆盖了已有文件 ${path}。如果你的意图是"修改局部"` +
              `（而不是完整重写），下次请改走 file_window.edit：先 open_file 把文件载入 file_window，` +
              `再 open(parent_window_id=<file_window_id>, command="edit", args={ old, new })。` +
              `write_file 适合新建文件或确实要丢弃整个旧版本的场景。`,
          });
        }
      }
      return { ok: true, object: fileWindow };
    }

    // open_file path
    const rawPath = isString(ctx.args.path) ? ctx.args.path : "";
    if (!rawPath) return { ok: false, error: "[open_file] 缺少 path。" };
    const path = resolveSessionPath(thread, rawPath);
    try {
      await stat(path);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return { ok: false, error: `[open_file] 文件不存在: ${path}` };
      }
      return { ok: false, error: `[open_file] 校验 path 失败: ${(err as Error).message}` };
    }
    const fileWindow: FileWindow = {
      id: generateWindowId("file"),
      type: "file",
      parentWindowId: ROOT_WINDOW_ID,
      title: basenameOfPath(path),
      status: "open",
      createdAt: Date.now(),
      path,
      viewport: { ...DEFAULT_VIEWPORT },
      lines: asTuple(ctx.args.lines),
      columns: asTuple(ctx.args.columns),
    };
    return { ok: true, object: fileWindow };
  },
};

builtinRegistry.registerObjectType("file", {
  methods: {
    set_range: setRangeCommand,
    set_viewport: setViewportCommand,
    reload: reloadCommand,
    edit: editCommand,
    close: closeCommand,
    file: fileConstructor,
  },
  readable,
  compressView: compressFileWindow,
});
