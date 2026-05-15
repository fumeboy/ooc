import * as knowledge from "@src/thinkable/knowledge/index";
import * as executable from "@src/executable/index";

/**
 * Knowledge activation 概念：knowledge 如何按 commandPaths 渐进式激活进入 context。
 *
 * sources:
 *  - knowledge — computeActivations / loadKnowledgeIndex
 *  - executable — collectExecutableKnowledgeEntries 合成 KnowledgeWindow 的入口
 */
export const knowledge_activation_v20260515_1 = {
  name: "KnowledgeActivation",
  description: `
Knowledge 在 OOC 中按 commandPaths 与 window 类型动态激活，最终统一表示为
KnowledgeWindow（type=knowledge）出现在 context 里。

来源分三类：

- **protocol**：全局 KNOWLEDGE 常量、root 命令清单（ROOT_KNOWLEDGE）、每个
  command_exec form 的 knowledge() 派生条目、每种 window type 注册的 basicKnowledge
- **activator**：stones/{id}/knowledge/*.md 经 commandPaths 命中。命中算法在
  computeActivations；命中后 presentation 决定 full vs summary
- **explicit**：用户通过 root.open_knowledge 主动 pin 的 knowledge_window

合成入口：collectExecutableKnowledgeEntries(thread.contextWindows, thread)。
该函数：

1. 收集 protocol 来源 entries
2. 按 thread.contextWindows 中实际出现的 window type，注入该 type 的 basicKnowledge
3. 把 protocol entries 合成为 KnowledgeWindow（source=protocol）
4. 加 activator 命中（source=activator + presentation）
5. 显式 knowledge_window 原样保留；activator 命中重复 path 时跳过

合成 window 仅在响应体里出现，不写回 thread.json 持久化字段。
`.trim(),
  sources: { knowledge, executable },
};
