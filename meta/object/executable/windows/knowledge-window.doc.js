import * as knowledgeWindow from "@src/executable/windows/knowledge";

/**
 * knowledge_window 概念：一段 knowledge 文本作为 window 出现在 context 中。
 *
 * sources:
 *  - knowledgeWindow — reload / close 命令注册 + onClose hook（拒绝非 explicit 来源关闭）
 */
export const knowledge_window_v20260515_1 = {
  name: "KnowledgeWindow",
  description: `
knowledge_window 是一段 knowledge 文本在 context 中的运行时载体。

按子字段展开：

- sources — source 字段的 3 类来源（explicit / protocol / activator），决定持久化与可关闭性
- commands — 2 个命令（reload 强制重算 / close 仅 explicit 可关）
- onCloseHook — onCloseKnowledgeWindow 拒绝 protocol/activator 关闭的 synthesizedGuard
`.trim(),
  sources: { knowledgeWindow },

  sourcesEntry: {
    title: "sources",
    content: `knowledge_window 的 source 字段区分 3 类来源，决定持久化与可关闭性。`,

    explicit: {
      title: "explicit",
      content: `
LLM 通过 root.open_knowledge 显式 pin 进 context；持久化进 thread.json；可被 close。
      `,
    },

    protocol: {
      title: "protocol",
      content: `
每轮自动注入的协议常量（KNOWLEDGE）+ 各 command_exec form 的 knowledge() 派生 +
每种 window type 的 basicKnowledge，由 collectExecutableKnowledgeEntries 合成。
仅出现在响应体，不写回 thread.json。
      `,
    },

    activator: {
      title: "activator",
      content: `
stones/{id}/knowledge/*.md 经 commandPaths 命中（computeActivations）后合成。
带 presentation（full / summary）决定渲染体积。仅出现在响应体，不写回 thread.json。
      `,
    },
  },

  commands: {
    title: "commands",
    content: `knowledge_window 注册 2 个 command。`,

    reload: {
      title: "reload",
      content: `
强制下一轮重新计算激活集合。

- exec 体 no-op；loader 已按 mtime 自动失效缓存
- 保留 command 主要是语义提示
      `,
    },

    close: {
      title: "close",
      content: `
释放 window；不影响 knowledge 文件本身。

- 仅 source=explicit 可被关闭
- source=protocol / activator 由 onClose hook 拒绝（见 onCloseHook.synthesizedGuard）
- 历史 window 没有 source 字段时按 explicit 处理（向后兼容）
      `,
    },
  },

  onCloseHook: {
    title: "on Close Hook",
    content: `onCloseKnowledgeWindow 注册到 type=knowledge 的 onClose hook。`,

    synthesizedGuard: {
      title: "synthesizedGuard",
      content: `
window.source 存在且非 "explicit"（即 protocol / activator）时拒绝关闭：

- 向 thread.events 追加 context_change.inject，文本
  [close 拒绝] knowledge_window "<path>" 来自 <source>，由系统每轮合成，不可显式关闭。
- 返回 false，保留 window
      `,
    },
  },
};
