/**
 * root.open_file command — 创建一个 file_window，把指定文件内容引入 context。
 *
 * spec § file_window：
 * - args: path（必填）, lines?, columns?
 * - C 规则总命中：args 给齐 path 即直建 file_window
 * - file_window 自身的 set_range / reload / close 由 windows/file.ts 注册
 */

import type {
  CommandExecutionContext,
  CommandKnowledgeEntries,
  CommandTableEntry,
} from "./types.js";
import {
  ROOT_WINDOW_ID,
  generateWindowId,
  type FileWindow,
} from "../windows/types.js";

const OPEN_FILE_BASIC_PATH = "internal/executable/open_file/basic";
const OPEN_FILE_INPUT_PATH = "internal/executable/open_file/input";

const KNOWLEDGE = `
open_file 用于把某个文件的内容作为 file_window 引入 context（持续可见，每轮重新读）。

参数：
- path: 必填，文件路径（绝对或工作目录相对）
- lines: 可选 [start, end] 行范围
- columns: 可选 [start, end] 列范围

后续操作：
- 调整范围：open(parent_window_id="<file_window_id>", command="set_range", args={ lines: [...] })
- 关闭：close(window_id="<file_window_id>")

调用示例：
open(command="open_file", title="读 README", args={ path: "README.md", lines: [0, 200] })
`.trim();

export const openFileCommand: CommandTableEntry = {
  paths: ["open_file"],
  match: () => ["open_file"],
  knowledge: (args, formStatus): CommandKnowledgeEntries => {
    const entries: CommandKnowledgeEntries = { [OPEN_FILE_BASIC_PATH]: KNOWLEDGE };
    if (formStatus !== "open") return entries;
    const path = typeof args.path === "string" ? args.path : "";
    if (!path) {
      entries[OPEN_FILE_INPUT_PATH] =
        "open_file 缺少 path；用 refine(args={ path: \"...\", lines?: [start,end], columns?: [start,end] })。";
    }
    return entries;
  },
  exec: (ctx) => executeOpenFileCommand(ctx),
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

function basename(path: string): string {
  const idx = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return idx >= 0 ? path.slice(idx + 1) : path;
}

export async function executeOpenFileCommand(
  ctx: CommandExecutionContext,
): Promise<string | undefined> {
  const thread = ctx.thread;
  if (!thread) return "[open_file] 缺少 thread context。";
  const path = typeof ctx.args.path === "string" ? ctx.args.path : "";
  if (!path) return "[open_file] 缺少 path。";

  const fileWindow: FileWindow = {
    id: generateWindowId("file"),
    type: "file",
    parentWindowId: ROOT_WINDOW_ID,
    title: basename(path),
    status: "open",
    createdAt: Date.now(),
    path,
    lines: asTuple(ctx.args.lines),
    columns: asTuple(ctx.args.columns),
  };

  if (ctx.manager) {
    ctx.manager.insertTypedWindow(fileWindow);
  } else {
    thread.contextWindows = [...(thread.contextWindows ?? []), fileWindow];
  }
  return undefined;
}
