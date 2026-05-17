import { commands_v20260506_1 } from "@meta/object/executable/actions/commands/index.doc";
import * as openKnowledgeSource from "@src/executable/windows/root/open-knowledge";

export const open_knowledge_v20260514_1 = {
  get parent() { return commands_v20260506_1; },
  name: "OpenKnowledge",
  sources: { open_knowledge: openKnowledgeSource },
  description: `
open_knowledge 显式打开一个 knowledge doc，作为 knowledge_window 持续可见。
作为 knowledge activator 渐进披露之外的"显式 pin"路径。

按子字段展开：

- callShape — 调用形态与参数
- submitEffects — knowledge_window 的产出
- knowledgeWindowCommands — knowledge_window 上注册的 reload / close
- activatorCollaboration — 与 knowledge activator 的协作顺序
- renderRules — 渲染层规则与失败兜底
`,

  callShape: {
    title: "call Shape",
    content: `

open(command="open_knowledge", title="pin file-ops", args={
  path: "build-tools/file-ops"   // 必填，相对 stones/{objectId}/knowledge/ 的路径，不带 .md
})


args 给齐时 open 立即提交 form。
    `,
  },

  submitEffects: {
    title: "submit Effects",
    content: `
submit 副作用：在 thread.contextWindows 下挂一个 type=knowledge 的 window。
窗口持续可见，loader 按 mtime 自动失效。
    `,
  },

  knowledgeWindowCommands: {
    title: "knowledge Window Commands",
    content: `
knowledge_window 上注册的两个 sub-command。
    `,

    reloadCmd: {
      title: "reload",
      content: `
强制下一轮重新计算激活集合。loader 已按 mtime 自动失效，主要是语义提示。
      `,
    },

    closeCmd: {
      title: "close",
      content: `
释放 window。
      `,
    },
  },

  activatorCollaboration: {
    title: "activator Collaboration",
    content: `
knowledge activator 在算激活集合时按顺序处理三类来源；同一篇 knowledge 不会重复出现。
    `,

    forcedPinFull: {
      title: "1. 强制 full（reason=\"pinned\"）",
      content: `
收集所有打开的 knowledge_window.path → 强制 full。
force-full 优先于自动激活。
      `,
    },

    commandPathFull: {
      title: "2. 命中 show_content_when → full",
      content: `
按 command_exec 的 commandPaths union 命中 show_content_when → full。
      `,
    },

    commandPathSummary: {
      title: "3. 命中 show_description_when → summary",
      content: `
命中 show_description_when → summary 形态（仅 description，无 body）。
      `,
    },
  },

  renderRules: {
    title: "render Rules",
    content: `
render 层在 renderKnowledgeWindowChildren 中按规则处理。
    `,

    loaderLookup: {
      title: "loader 查找",
      content: `
调 loader index 找 doc。
      `,
    },

    bodyTruncate: {
      title: "渲染 + 截断",
      content: `
渲染 description + body，按 8KB 截断。
      `,
    },

    notFoundFallback: {
      title: "找不到时兜底",
      content: `
找不到时输出 <error> 子节点而不是抛错。
      `,
    },
  },
};
