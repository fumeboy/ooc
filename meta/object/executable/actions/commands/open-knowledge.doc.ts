import type { Concept, DocNode } from "@meta/doc-types";
import { commands_v20260506_1 } from "@meta/object/executable/actions/commands/index.doc";
import * as openKnowledgeSource from "@src/executable/windows/root/open-knowledge";

/* ────────────────────────────────────────────────────────────────
 *  目录页：root.open_knowledge command 的全貌
 * ──────────────────────────────────────────────────────────────── */

/**
 * OpenKnowledge 概念：显式打开一个 knowledge doc 作为持续可见的 knowledge_window。
 *
 * sources:
 *  - open_knowledge — root.open_knowledge command 实现
 */
export type OpenKnowledgeConcept = Concept & {
  sources: { open_knowledge: typeof openKnowledgeSource };

  /** 调用形态与参数 */
  callShape: DocNode;

  /** submit 副作用：knowledge_window 的产出 */
  submitEffects: DocNode;

  /** knowledge_window 上注册的 reload / close */
  knowledgeWindowCommands: {
    title: string;
    summary?: string;
    reloadCmd: DocNode;
    closeCmd: DocNode;
  };

  /** 与 knowledge activator 的协作顺序 */
  activatorCollaboration: {
    title: string;
    summary?: string;
    forcedPinFull: DocNode;
    commandPathFull: DocNode;
    commandPathSummary: DocNode;
  };

  /** 渲染层规则与失败兜底 */
  renderRules: {
    title: string;
    summary?: string;
    loaderLookup: DocNode;
    bodyTruncate: DocNode;
    notFoundFallback: DocNode;
  };
};

/* ────────────────────────────────────────────────────────────────
 *  数据填充
 * ──────────────────────────────────────────────────────────────── */

export const open_knowledge_v20260514_1: OpenKnowledgeConcept = {
  name: "OpenKnowledge",
  get parent() {
    return commands_v20260506_1;
  },
  sources: { open_knowledge: openKnowledgeSource },
  description: `
open_knowledge 显式打开一个 knowledge doc，作为 knowledge_window 持续可见。
作为 knowledge activator 渐进披露之外的"显式 pin"路径。
`.trim(),

  callShape: {
    title: "调用形态",
    summary: "args 给齐时 open 立即提交 form",
    content: `
\`\`\`
open(command="open_knowledge", title="pin file-ops", args={
  path: "build-tools/file-ops"   // 必填，相对 stones/{objectId}/knowledge/ 的路径，不带 .md
})
\`\`\`

args 给齐时 open 立即提交 form。
    `.trim(),
  },

  submitEffects: {
    title: "submit 副作用",
    summary: "在 thread.contextWindows 下挂一个 type=knowledge 的 window",
    content: `
submit 副作用：在 thread.contextWindows 下挂一个 type=knowledge 的 window。
窗口持续可见，loader 按 mtime 自动失效。
    `.trim(),
  },

  knowledgeWindowCommands: {
    title: "knowledge_window 子命令",
    summary: "knowledge_window 上注册的两个 sub-command",

    reloadCmd: {
      title: "reload",
      content: `
强制下一轮重新计算激活集合。loader 已按 mtime 自动失效，主要是语义提示。
      `.trim(),
    },

    closeCmd: {
      title: "close",
      content: "释放 window。",
    },
  },

  activatorCollaboration: {
    title: "与 activator 协作",
    summary: "activator 按 3 类来源顺序处理，同一篇 knowledge 不重复",

    forcedPinFull: {
      title: '1. 强制 full (reason="pinned")',
      content: `
收集所有打开的 knowledge_window.path → 强制 full。
force-full 优先于自动激活。
      `.trim(),
    },

    commandPathFull: {
      title: "2. 命中 show_content_when → full",
      content: "按 command_exec 的 commandPaths union 命中 show_content_when → full。",
    },

    commandPathSummary: {
      title: "3. 命中 show_description_when → summary",
      content: "命中 show_description_when → summary 形态（仅 description，无 body）。",
    },
  },

  renderRules: {
    title: "渲染规则",
    summary: "renderKnowledgeWindowChildren 中的规则",

    loaderLookup: {
      title: "loader 查找",
      content: "调 loader index 找 doc。",
    },

    bodyTruncate: {
      title: "渲染 + 截断",
      content: "渲染 description + body，按 8KB 截断。",
    },

    notFoundFallback: {
      title: "找不到时兜底",
      content: "找不到时输出 <error> 子节点而不是抛错。",
    },
  },
};
