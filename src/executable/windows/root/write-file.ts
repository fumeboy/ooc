/**
 * root.write_file command — 创建或覆盖一个文件，并自动 spawn 一个 file_window 指向它。
 *
 * - args: path（必填）, content（必填）
 * - 父目录不存在时自动 mkdir -p
 * - 写盘成功后立即 spawn 一个 file_window，让接下来的 file_window.edit 与 LLM 后续的
 *   "open_file then edit" 体验完全一致
 * - 失败时返回错误字符串；不会留下半成品 file_window
 *
 * 与 program(language="shell", code="echo ... > ...") 的差别：write_file 表达的是
 * "把这段内容当作文件版本"，自带版本可见性（file_window 渲染）；shell 重定向是黑盒。
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type {
  CommandExecutionContext,
  CommandKnowledgeEntries,
  CommandTableEntry,
} from "../command-types.js";
import {
  ROOT_WINDOW_ID,
  generateWindowId,
  type FileWindow,
} from "../types.js";
import { resolveSessionPath } from "../session-path.js";

const WRITE_FILE_BASIC_PATH = "internal/executable/write_file/basic";
const WRITE_FILE_INPUT_PATH = "internal/executable/write_file/input";

const KNOWLEDGE = `
write_file 用于创建一个新文件或完整覆盖一个已有文件，并自动 spawn 一个 file_window 指向它，
便于后续用 file_window.edit 做精确修改。

参数：
- path: 必填，目标文件路径（绝对，或相对 session baseDir）。父目录不存在会自动 mkdir -p
- content: 必填，要写入的完整文件内容（字符串；空字符串表示写一个 0 字节文件）

写盘成功后副作用：
- 在 thread.contextWindows 下挂一个 type=file 的 window 指向 path
- LLM 接下来可以直接 \`open(parent_window_id="<file_window_id>", command="edit", ...)\`

失败场景（如权限不足、路径不合法）：返回错误字符串，不留 file_window，不写盘。

调用示例：

\`\`\`
open(command="write_file", title="新建测试文件",
     args={ path: "tests/foo.test.ts", content: "import { it } from 'bun:test'; ..." })
\`\`\`

注意：
- 这是创建新文件 / 完全覆盖的命令；要修改已有文件的部分内容，请用 file_window.edit
- 不要用 program(language="shell", code="echo ... > ...") 做这件事——会失去 file_window 的版本可见性
`.trim();

function basename(path: string): string {
  const idx = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return idx >= 0 ? path.slice(idx + 1) : path;
}

export const writeFileCommand: CommandTableEntry = {
  paths: ["write_file"],
  match: () => ["write_file"],
  knowledge: (args, formStatus): CommandKnowledgeEntries => {
    const entries: CommandKnowledgeEntries = { [WRITE_FILE_BASIC_PATH]: KNOWLEDGE };
    if (formStatus !== "open") return entries;
    const path = typeof args.path === "string" ? args.path : "";
    const hasContent = typeof args.content === "string";
    if (!path || !hasContent) {
      entries[WRITE_FILE_INPUT_PATH] =
        "write_file 缺少必填参数：args={ path: \"...\", content: \"...\" }。content 可以是空字符串。";
    }
    return entries;
  },
  exec: (ctx) => executeWriteFileCommand(ctx),
};

export async function executeWriteFileCommand(
  ctx: CommandExecutionContext,
): Promise<string | undefined> {
  const thread = ctx.thread;
  if (!thread) return "[write_file] 缺少 thread context。";
  const rawPath = typeof ctx.args.path === "string" ? ctx.args.path : "";
  if (!rawPath) return "[write_file] 缺少 path 参数。";
  const content = ctx.args.content;
  if (typeof content !== "string") return "[write_file] 缺少 content 参数（应是字符串，可为空）。";

  // 相对路径以 session baseDir 为根（不再以 OOC 进程 cwd 为根）
  const path = resolveSessionPath(thread, rawPath);

  try {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content, "utf8");
  } catch (err) {
    return `[write_file] 写入 ${path} 失败：${(err as Error).message}`;
  }

  const fileWindow: FileWindow = {
    id: generateWindowId("file"),
    type: "file",
    parentWindowId: ROOT_WINDOW_ID,
    title: basename(path),
    status: "open",
    createdAt: Date.now(),
    path,
  };

  if (ctx.manager) {
    ctx.manager.insertTypedWindow(fileWindow);
  } else {
    thread.contextWindows = [...(thread.contextWindows ?? []), fileWindow];
  }
  return undefined;
}
