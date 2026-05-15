/**
 * file_window — 在 context 中显示某个文件的内容窗口。
 *
 * - 由 root.open_file / root.write_file 创建（args: path, lines?, columns?）
 * - 注册的 command：set_range / reload / edit / close
 *   - set_range：调整 lines / columns 切片
 *   - reload：重新读文件（render 层每轮都会读，所以 reload 主要是语义提示）
 *   - edit：基于"oldString → newString"做精确唯一替换；支持 array 形式做 atomic 多点修改
 *   - close：释放 window
 * - 渲染：render 层在 renderFileWindowChildren 中按 lines/columns 切片，32KB 截断
 */

import { readFile, writeFile } from "node:fs/promises";

import type {
  CommandExecutionContext,
  CommandKnowledgeEntries,
  CommandTableEntry,
} from "./command-types.js";
import { registerWindowType } from "./registry.js";
import type { FileWindow } from "./types.js";

const FILE_WINDOW_SET_RANGE_BASIC = "internal/windows/file/set_range/basic";
const FILE_WINDOW_RELOAD_BASIC = "internal/windows/file/reload/basic";
const FILE_WINDOW_CLOSE_BASIC = "internal/windows/file/close/basic";
const FILE_WINDOW_EDIT_BASIC = "internal/windows/file/edit/basic";
const FILE_WINDOW_EDIT_INPUT = "internal/windows/file/edit/input";

const SET_RANGE_KNOWLEDGE = `
file_window.set_range 调整文件的可见范围（行/列切片）。

参数：
- lines: 可选 [start, end]
- columns: 可选 [start, end]

例：refine(form, args={ lines: [0, 200] }) → 仅展示前 200 行
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

## 与 shell 改文件的对比

不要再用 \`program(language="shell", code="sed -i ...")\` 改文件——容易踩转义陷阱、丢失
file_window 的可见性、并且无法表达 atomic 多点修改。
`.trim();

const setRangeCommand: CommandTableEntry = {
  paths: ["set_range"],
  match: () => ["set_range"],
  knowledge: (): CommandKnowledgeEntries => ({ [FILE_WINDOW_SET_RANGE_BASIC]: SET_RANGE_KNOWLEDGE }),
  exec: (ctx) => executeFileWindowSetRange(ctx),
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

registerWindowType("file", {
  commands: {
    set_range: setRangeCommand,
    reload: reloadCommand,
    edit: editCommand,
    close: closeCommand,
  },
});
