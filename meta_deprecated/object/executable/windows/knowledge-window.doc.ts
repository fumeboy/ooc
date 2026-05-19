import type { Concept, DocNode } from "@meta/doc-types";
import * as knowledgeWindow from "@src/executable/windows/knowledge";

/**
 * knowledge_window 概念：一段 knowledge 文本作为 window 出现在 context 中。
 *
 * sources:
 *  - knowledgeWindow — reload / close 命令注册 + onClose hook
 *    （拒绝非 explicit 来源关闭）
 */
export type KnowledgeWindowConcept = Concept & {
  sources: { knowledgeWindow: typeof knowledgeWindow };

  /** source 字段的 3 类来源，决定持久化与可关闭性 */
  sourcesEntry: {
    title: string;
    summary?: string;
    /** LLM open_knowledge 显式 pin，可被 close */
    explicit: DocNode;
    /** 系统每轮合成的协议常量与派生 knowledge */
    protocol: DocNode;
    /** commandPath 命中后激活的 knowledge */
    activator: DocNode;
  };

  /** 2 个命令（reload 强制重算 / close 仅 explicit 可关） */
  commands: {
    title: string;
    summary?: string;
    /** 强制下一轮重新计算激活集合 */
    reload: DocNode;
    /** 释放 explicit window；其它来源走 onClose 拒绝 */
    close: DocNode;
  };

  /** onCloseKnowledgeWindow hook：拒绝合成来源关闭 */
  onCloseHook: {
    title: string;
    summary?: string;
    /** protocol / activator 来源拒关 */
    synthesizedGuard: DocNode;
  };
};

export const knowledge_window_v20260515_1: KnowledgeWindowConcept = {
  name: "KnowledgeWindow",
  sources: { knowledgeWindow },
  description: `
knowledge_window 是一段 knowledge 文本在 context 中的运行时载体。
按来源（explicit / protocol / activator）区分持久化与可关闭性。
`.trim(),

  sourcesEntry: {
    title: "source 来源分类",
    summary: "explicit / protocol / activator 三类来源决定持久化与可关闭性",

    explicit: {
      title: "explicit",
      content: `
LLM 通过 root.open_knowledge 显式 pin 进 context；持久化进 thread.json；可被 close。
      `.trim(),
    },

    protocol: {
      title: "protocol",
      content: `
每轮自动注入的协议常量（KNOWLEDGE）+ 各 command_exec form 的 knowledge() 派生 +
每种 window type 的 basicKnowledge，由 collectExecutableKnowledgeEntries 合成。
仅出现在响应体，不写回 thread.json。
      `.trim(),
    },

    activator: {
      title: "activator",
      content: `
stones/{id}/knowledge/*.md 经 commandPaths 命中（computeActivations）后合成。
带 presentation（full / summary）决定渲染体积。仅出现在响应体，不写回 thread.json。
      `.trim(),
    },
  },

  commands: {
    title: "命令面",
    summary: "knowledge_window 注册 2 个 command",

    reload: {
      title: "reload",
      content: `
强制下一轮重新计算激活集合。

- exec 体 no-op；loader 已按 mtime 自动失效缓存
- 保留 command 主要是语义提示
      `.trim(),
    },

    close: {
      title: "close",
      content: `
释放 window；不影响 knowledge 文件本身。

- 仅 source=explicit 可被关闭
- source=protocol / activator 由 onClose hook 拒绝
- 历史 window 没有 source 字段时按 explicit 处理（向后兼容）
      `.trim(),
    },
  },

  onCloseHook: {
    title: "onClose hook",
    summary: "onCloseKnowledgeWindow 注册到 type=knowledge 的 onClose hook",

    synthesizedGuard: {
      title: "synthesizedGuard",
      content: `
window.source 存在且非 "explicit"（即 protocol / activator）时拒绝关闭：

- 向 thread.events 追加 context_change.inject，文本
  [close 拒绝] knowledge_window "<path>" 来自 <source>，由系统每轮合成，不可显式关闭。
- 返回 false，保留 window
      `.trim(),
    },
  },
};
