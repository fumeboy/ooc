/**
 * root.open_file command — 创建一个 file_window，把指定文件内容引入 context。
 *
 * - args: path（必填）, lines?, columns?
 * - 给齐 path 即直建 file_window（open 立即提交 form）
 * - file_window 自身的 set_range / reload / close 由 windows/file.ts 注册
 */

import type {
  CommandExecutionContext,
  CommandKnowledgeEntries,
  CommandTableEntry,
} from "../_shared/command-types.js";
import {
  ROOT_WINDOW_ID,
  generateWindowId,
  type FileWindow,
} from "../_shared/types.js";
import { resolveSessionPath } from "../_shared/session-path.js";
import { stat } from "node:fs/promises";

const OPEN_FILE_BASIC_PATH = "internal/executable/open_file/basic";
const OPEN_FILE_INPUT_PATH = "internal/executable/open_file/input";

const KNOWLEDGE = `
open_file 用于把某个文件的内容作为 file_window 引入 context（持续可见，每轮重新读）。

参数：
- path: 必填，文件路径（绝对，或相对 session baseDir）
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
  const rawPath = typeof ctx.args.path === "string" ? ctx.args.path : "";
  if (!rawPath) return "[open_file] 缺少 path。";

  // 相对路径以 session baseDir 为根（不再以 OOC 进程 cwd 为根）
  const path = resolveSessionPath(thread, rawPath);

  // silent-swallow ban: exec 层显式校验 path 存在性,避免 render 层 <error> 内联兜底
  try {
    await stat(path);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return `[open_file] 文件不存在: ${path}`;
    }
    return `[open_file] 校验 path 失败: ${(err as Error).message}`;
  }

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
