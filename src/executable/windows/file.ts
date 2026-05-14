/**
 * file_window — 在 context 中显示某个文件的内容窗口。
 *
 * spec § file_window：
 * - 由 root.open_file 创建（args: path, lines?, columns?）
 * - 注册的 command：set_range / reload / close
 *   - set_range：调整 lines / columns 切片
 *   - reload：重新读文件（render 层每轮都会读，所以 reload 主要是语义提示）
 *   - close：释放 window
 * - 渲染：render 层在 renderFileWindowChildren 中按 lines/columns 切片，32KB 截断
 */

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

registerWindowType("file", {
  commands: {
    set_range: setRangeCommand,
    reload: reloadCommand,
    close: closeCommand,
  },
});
