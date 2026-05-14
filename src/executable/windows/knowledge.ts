/**
 * knowledge_window — 显式打开的 knowledge doc 窗口。
 *
 * spec § knowledge_window：
 * - 由 root.open_knowledge 创建（args: path）
 * - 注册的 command：reload / close
 *   - reload：强制下一轮重新计算激活集合（render 每轮都会查 loader index，所以是语义提示）
 *   - close：释放 window
 * - activator 在算激活集合时会把已打开的 knowledge_window.path 视为强制 full
 * - 渲染：render 层在 renderKnowledgeWindowChildren 中查 loader index 取 doc.body，8KB 截断
 */

import type {
  CommandKnowledgeEntries,
  CommandTableEntry,
} from "../commands/types.js";
import { registerWindowType } from "./registry.js";

const KNOWLEDGE_WINDOW_RELOAD_BASIC = "internal/windows/knowledge/reload/basic";
const KNOWLEDGE_WINDOW_CLOSE_BASIC = "internal/windows/knowledge/close/basic";

const RELOAD_KNOWLEDGE = `
knowledge_window.reload 强制下一轮重新计算激活集合。当前 loader 已按 mtime 自动失效缓存，
本命令主要是语义提示。
`.trim();

const CLOSE_KNOWLEDGE = `
knowledge_window.close 释放 window；不影响 knowledge 文件本身。
`.trim();

const reloadCommand: CommandTableEntry = {
  paths: ["reload"],
  match: () => ["reload"],
  knowledge: (): CommandKnowledgeEntries => ({ [KNOWLEDGE_WINDOW_RELOAD_BASIC]: RELOAD_KNOWLEDGE }),
  exec: () => undefined,
};

const closeCommand: CommandTableEntry = {
  paths: ["close"],
  match: () => ["close"],
  knowledge: (): CommandKnowledgeEntries => ({ [KNOWLEDGE_WINDOW_CLOSE_BASIC]: CLOSE_KNOWLEDGE }),
  exec: () => undefined,
};

registerWindowType("knowledge", {
  commands: {
    reload: reloadCommand,
    close: closeCommand,
  },
});
