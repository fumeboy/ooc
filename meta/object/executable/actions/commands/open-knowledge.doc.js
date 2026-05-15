import { commands_v20260506_1 } from "@meta/object/executable/actions/commands/index.doc";
import * as openKnowledgeSource from "@src/executable/windows/root/open-knowledge";

export const open_knowledge_v20260514_1 = {
  get parent() { return commands_v20260506_1; },
  name: "OpenKnowledge",
  get description() { return this.index; },
  index: `
\`open_knowledge\` 用于显式打开一个 knowledge doc，作为 knowledge_window 持续可见。

替代旧 pinnedKnowledge 机制（spec 2026-05-14 § 迁移节奏 Step 2）。

## 调用形式

\`\`\`
open(command="open_knowledge", title="pin file-ops", args={
  path: "build-tools/file-ops"   // 必填，相对 stones/{objectId}/knowledge/ 的路径，不带 .md
})
\`\`\`

> args 给齐时 open 立即提交 form。

submit 副作用：在 thread.contextWindows 下挂一个 type=knowledge 的 window。

## knowledge_window 的注册命令

| command | 行为 |
|---|---|
| reload  | 强制下一轮重新计算激活集合（loader 已按 mtime 自动失效，主要是语义提示） |
| close   | 释放 window |

## 与 activator 的协作

knowledge activator 在算激活集合时：
1. 收集所有打开的 knowledge_window.path → 强制 full（reason="pinned"）
2. 再按 command_exec 的 commandPaths union 命中 show_content_when → full
3. 最后命中 show_description_when → summary

force-full 优先于自动激活；同一篇 knowledge 不会重复出现。

## 渲染

render 层在 renderKnowledgeWindowChildren 中：
- 调 loader index 找 doc
- 渲染 description + body（按 8KB 截断）
- 找不到时输出 \`<error>\` 子节点
`,
  sources: {
    open_knowledge: openKnowledgeSource,
  },
};
