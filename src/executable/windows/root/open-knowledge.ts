/**
 * root.open_knowledge command — 显式打开一个 knowledge doc 作为 knowledge_window。
 *
 * spec § knowledge_window：
 * - args: path（必填，相对 stones/{objectId}/knowledge/ 的路径，不带 .md）
 * - C 规则总命中：args 给齐 path 即直建 knowledge_window
 * - knowledge activator 在算激活集合时把所有打开的 knowledge_window.path 视为 force-full
 * - render 层从 loader index 拿 doc 正文渲染
 */

import type {
  CommandExecutionContext,
  CommandKnowledgeEntries,
  CommandTableEntry,
} from "../command-types.js";
import {
  ROOT_WINDOW_ID,
  generateWindowId,
  type KnowledgeWindow,
} from "../types.js";

const OPEN_KNOWLEDGE_BASIC_PATH = "internal/executable/open_knowledge/basic";
const OPEN_KNOWLEDGE_INPUT_PATH = "internal/executable/open_knowledge/input";

const KNOWLEDGE = `
open_knowledge 用于显式打开一个 knowledge doc，作为 knowledge_window 持续可见。

参数：
- path: 必填，knowledge 索引中的路径（不带 .md，例如 "build-tools/file-ops"）

打开后该 knowledge 会强制以 full 形式渲染（绕过 activator 的 command-path 命中规则），
直到显式 close。等价于旧 pinnedKnowledge。

后续：
- 关闭：close(window_id="<knowledge_window_id>")

调用示例：
open(command="open_knowledge", title="pin file-ops", args={ path: "build-tools/file-ops" })
`.trim();

export const openKnowledgeCommand: CommandTableEntry = {
  paths: ["open_knowledge"],
  match: () => ["open_knowledge"],
  knowledge: (args, formStatus): CommandKnowledgeEntries => {
    const entries: CommandKnowledgeEntries = { [OPEN_KNOWLEDGE_BASIC_PATH]: KNOWLEDGE };
    if (formStatus !== "open") return entries;
    const path = typeof args.path === "string" ? args.path : "";
    if (!path) {
      entries[OPEN_KNOWLEDGE_INPUT_PATH] =
        "open_knowledge 缺少 path；用 refine(args={ path: \"...\" })。";
    }
    return entries;
  },
  exec: (ctx) => executeOpenKnowledgeCommand(ctx),
};

function basename(path: string): string {
  const idx = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return idx >= 0 ? path.slice(idx + 1) : path;
}

export async function executeOpenKnowledgeCommand(
  ctx: CommandExecutionContext,
): Promise<string | undefined> {
  const thread = ctx.thread;
  if (!thread) return "[open_knowledge] 缺少 thread context。";
  const path = typeof ctx.args.path === "string" ? ctx.args.path : "";
  if (!path) return "[open_knowledge] 缺少 path。";

  const knowledgeWindow: KnowledgeWindow = {
    id: generateWindowId("knowledge"),
    type: "knowledge",
    parentWindowId: ROOT_WINDOW_ID,
    title: basename(path),
    status: "open",
    createdAt: Date.now(),
    path,
    source: "explicit",
  };

  if (ctx.manager) {
    ctx.manager.insertTypedWindow(knowledgeWindow);
  } else {
    thread.contextWindows = [...(thread.contextWindows ?? []), knowledgeWindow];
  }
  return undefined;
}
