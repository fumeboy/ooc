import type {
  CommandKnowledgeEntries,
  CommandTableEntry,
} from "../_shared/command-types.js";

const TALK_WINDOW_CLOSE_BASIC = "internal/windows/talk/close/basic";
const CLOSE_KNOWLEDGE = `
talk_window.close 等价于 close tool；明确表达"结束本对话主题"。

注意：creator talk_window（callee thread 自带的、指向 caller 的那一条）不可关闭，
关闭会被拒绝并写一条 inject 提示。其它 talk_window 关闭后不会通知对端。
`.trim();

export const closeCommand: CommandTableEntry = {
  paths: ["close"],
  match: () => ["close"],
  knowledge: (): CommandKnowledgeEntries => ({ [TALK_WINDOW_CLOSE_BASIC]: CLOSE_KNOWLEDGE }),
  // close 副作用统一在 onClose hook，exec 体本身 no-op
  exec: () => undefined,
};
