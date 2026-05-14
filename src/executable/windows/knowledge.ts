/**
 * knowledge_window — 一段 knowledge 文本作为 window 出现在 context 中。
 *
 * 三种 source：
 * - explicit  ：LLM 显式 \`open(command="open_knowledge")\` 创建；持久化；可 close
 * - protocol  ：每轮自动注入的协议常量（KNOWLEDGE）+ 各 command_exec form 的 knowledge() 派生
 * - activator ：stones/{id}/knowledge/*.md 经 commandPaths 命中合成；带 presentation
 *
 * 后两种由 src/executable/index.ts: synthesizeKnowledgeWindows 在 buildInputItems 阶段
 * 合成到 thread.contextWindows 的副本上，不会持久化。
 *
 * 注册的 command：reload / close
 * - reload：强制下一轮重新激活；loader 已按 mtime 失效缓存，主要是语义提示
 * - close：仅 explicit 来源可关闭；protocol / activator 由 onClose hook 拒绝
 */

import type {
  CommandKnowledgeEntries,
  CommandTableEntry,
} from "./command-types.js";
import { registerWindowType, type OnCloseContext } from "./registry.js";

const KNOWLEDGE_WINDOW_RELOAD_BASIC = "internal/windows/knowledge/reload/basic";
const KNOWLEDGE_WINDOW_CLOSE_BASIC = "internal/windows/knowledge/close/basic";

const RELOAD_KNOWLEDGE = `
knowledge_window.reload 强制下一轮重新计算激活集合。当前 loader 已按 mtime 自动失效缓存，
本命令主要是语义提示。
`.trim();

const CLOSE_KNOWLEDGE = `
knowledge_window.close 释放 window；不影响 knowledge 文件本身。

注意：source=protocol / source=activator 的 knowledge_window 是系统每轮自动合成的，
不存在于 thread.contextWindows 持久状态——LLM 也无法 close 它们（hook 会拒绝）。
仅 source=explicit（来自 open_knowledge）的 window 可被 close。
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

/** 拒绝 close 非 explicit 来源的 knowledge_window（合成 window 不可关闭）。 */
function onCloseKnowledgeWindow(ctx: OnCloseContext): boolean | void {
  const w = ctx.window;
  if (w.type !== "knowledge") return;
  // 历史 window 没有 source 字段时按 explicit 处理（向后兼容）
  if (w.source && w.source !== "explicit") {
    ctx.thread.events.push({
      category: "context_change",
      kind: "inject",
      text: `[close 拒绝] knowledge_window "${w.path}" 来自 ${w.source}，由系统每轮合成，不可显式关闭。`,
    });
    return false;
  }
}

registerWindowType("knowledge", {
  commands: {
    reload: reloadCommand,
    close: closeCommand,
  },
  onClose: onCloseKnowledgeWindow,
});
