import * as executable from "@src/executable/index";

/**
 * 渐进式披露概念：context 每一刻只装载"当前必需"的知识。
 *
 * sources:
 *  - executable — collectExecutableKnowledgeEntries 把 protocol/activator/explicit
 *    三类 knowledge 合成为 KnowledgeWindow 的入口
 */
export const progressive_disclosure_v20260515_1 = {
  name: "ProgressiveDisclosure",
  description: `
整个行动机制围绕 **渐进式披露** 设计：

\`\`\`
LLM 想做某件事
   ↓
open(parent_window_id?, command=X) 表达意图，分配 form_id
（如 args 已给齐 → open 立即提交 form）
   ↓
对应 knowledge 进入 context（LLM 看到完整 API、注意事项、示例）
   ↓
LLM 在已知信息基础上 refine 参数（可多次累积）
   ↓
refine 触发新的 command path → 增量激活更多 knowledge
   ↓
LLM 想清楚后 submit 执行
   ↓
form 切到 executing 状态
   ↓
command 完成且成功 → form 自动从 contextWindows 移除；
                    若产出新 window（do_window 等），新 window 挂在 root 下
失败 → form 保留 executed + result，等 LLM 显式 close
\`\`\`

意义：context 每一刻只装载"当前必需"的知识，而不是预先塞满所有可能用到的能力描述。
具体落地由 collectExecutableKnowledgeEntries 把以下三类合成为 KnowledgeWindow：

- protocol — 全局 KNOWLEDGE 常量、root 命令清单、每个 command_exec form 的 knowledge() 派生条目、
  每种 window type 的 basicKnowledge
- activator — stones/{id}/knowledge/*.md 经 commandPaths 命中（full / summary）
- explicit — 用户通过 open_knowledge 显式打开的 knowledge_window
`.trim(),
  sources: { executable },
};
