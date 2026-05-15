import * as registry from "@src/executable/windows/registry";

/**
 * WindowRegistry 概念：每种 ContextWindow 类型的"行为契约"集中注册点。
 *
 * sources:
 *  - registry — registerWindowType / getWindowTypeDefinition + type-level basicKnowledge
 */
export const window_registry_v20260515_1 = {
  name: "WindowRegistry",
  description: `
每种 ContextWindow type 的契约集中在 WindowRegistry：

- commands：该 window 注册的、LLM 可通过 open(parent_window_id, command, ...) 调用的 command 集合
- onClose：close 触发时的副作用（如 do_window 的 archive、talk_window 拒绝关闭 creator window）
- renderXml：把该 window 投影成 system context 的 XML 节点
- basicKnowledge：可选；当 thread.contextWindows 中出现该 type 的实例时，
  collectExecutableKnowledgeEntries 自动把这段文本合成为一个 protocol KnowledgeWindow，
  让 LLM 在没有 open 任何 command_exec 的情况下也知道该类型有哪些 command 可调

注册方式：windows/<type>.ts 在模块加载时调用 registerWindowType(type, partial)。
新增 window type 必须在 REGISTRY 中先 set 一个空契约占位，再由实现侧注入。
`.trim(),
  sources: { registry },
};
