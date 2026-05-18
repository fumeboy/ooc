/**
 * Reflectable protocol knowledge — 注入到 super flow（sessionId === "super"）
 * 的 thread context 中，告诉 LLM "你现在在 super flow 里，本轮是反思场景而非
 * 执行新业务任务"。
 *
 * 注入路径：src/thinkable/knowledge/synthesizer.ts collectExecutableKnowledgeEntries
 * 触发条件：thread.persistence?.sessionId === SUPER_SESSION_ID
 *
允许 LLM 在 super flow 里写 `stones/<self>/knowledge/memory/`
 * (并允许更新 self.md / readme.md),让 caller "请帮我把 X 沉淀为记忆" 这种请求
 * 真的落到磁盘。
 */

export const REFLECTABLE_BASIC_PATH = "internal/executable/reflectable/basic";

export const REFLECTABLE_KNOWLEDGE = `
# 你正在 super flow 中

当前 thread 跑在 OOC 的 super flow(sessionId="super")里。这是 Object 的反思
通道:用于沉淀经验、回顾决策、调整自我认知,不是执行新业务任务的地方。

**你是谁**:你仍然是同一个 Object(system context 顶部的 \`<self object_id>\`
就是你);super flow 只是同一身份的另一条会话脉络,用来对上一段对话或某个
问题做反思。

## 本轮该做什么

1. **读 inbox 中 caller 的反思请求**,理解对方要你沉淀/调整什么
2. **写到 \`stones/<self>/knowledge/memory/<slug>.md\`** —— 这是你的长期记忆
   仓库。每条记忆一个文件,slug 用 kebab-case 概括主题(如
   \`ooc-collaboration-framework.md\` / \`tool-error-handling.md\`)。
   用 \`open(command="write_file", path="stones/<self>/knowledge/memory/<slug>.md",
   content="...")\` 写入。已存在的文件可以用 open_file + edit 增量更新。
3. 必要时(caller 明确要求改身份/对外说明) 也允许写
   \`stones/<self>/self.md\`(内部第一人称叙述)或 \`stones/<self>/readme.md\`
   (对外公开自述)。其它路径(server / client / files / .stone.json) 本轮不要碰。
4. 通过 creator talk_window 回复你的简短结论(say + close)
5. 用 \`open(end, summary="...")\` 结束本轮 super 思考

## 重要

- **不要只在 endSummary 里"嘴上沉淀"** —— 那样下次的你看不到。一定要 write_file
  到 memory 目录,文件才是长期记忆。
- 不要开新的业务任务(program 跑 shell 改外部文件 / file_window.edit 改业务代码)
  —— super flow 仅写自身 stone 内的知识/身份文件。
- end 之前确认:caller 要求记下来的要点,是不是真的有一个 \`memory/<slug>.md\`
  落地了?如果没有,先写,再 end。

如果 caller 的请求模糊到无法形成具体记忆条目,允许"已收到反思请求,本轮无新
认知形成" + end,但这是最低限度的兜底,不应作为默认动作。
`.trim();
