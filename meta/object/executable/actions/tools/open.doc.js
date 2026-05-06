import { tools_v20260506_1 } from "@meta/object/executable/actions/tools/index.doc";

export const open_v20260506_1 = {
    parent: tools_v20260506_1,
    index: `
\`open\` 用于开始一次行动 / 加载一个资源到 Context。

按 \`type\` 分支处理（5 种）：

| type | 用途 | 是否产生 form |
|---|---|---|
| command   | 开始一次 command 调用，分配 form_id | 是 |
| knowledge | 显式 pin 一篇 knowledge，让其完整正文进入 Context | 是（特殊 form，记录已 pin 的 knowledge） |
| file      | 把一个文件的内容窗口注入 Context | 是 |
| todo      | 创建一项待办 form | 是 |

## type=command

\`\`\`
open(
  type="command",
  command="program",        // 必填，目标 command 名（详见 actions/commands）
  description="…",          // 简短说明本次行动的意图
  args?: {...}              // 可选；等价于 open + refine(args)
)
\`\`\`

行为：
1. FormManager.begin 创建 form，分配 form_id
2. 根据 command 默认路径（如 "program"）调 \`deriveCommandPaths(command, {})\` 得到激活路径集合
3. 激活路径对应的 knowledge（activates_on.show_content_when 命中）进入 Context
4. 如果传了 args，立即执行一次 refine 累积参数（路径可能扩展）

返回 form_id，供后续 refine / submit / close 引用。

## type=knowledge

\`\`\`
open(
  type="knowledge",
  name="kernel:computable/file_ops",     // 必填，knowledge id
  description="想看 file_ops 的完整 API"
)
\`\`\`

行为：
- activateKnowledge + pinKnowledge：knowledge 进入 \`activatedKnowledge\` 与 \`pinnedKnowledge\` 两个列表
- 该 knowledge 完整正文注入 Context
- pinned 的 knowledge **不**会因为其他 form submit/close 自动卸载，只能通过 \`close(type=knowledge, name=...)\` 显式 unpin

适用场景：临时想查阅某篇 knowledge 全文，与当前 form 的 command 无关。

## type=file

\`\`\`
open(
  type="file",
  path="/path/to/file.md",
  lines?: [1, 200],           // 可选，行号窗口
  description="…"
)
\`\`\`

行为：把文件内容（按 lines 窗口截取）注入 Context 的 knowledge 区段。关闭通过 \`close\` 释放窗口。

## type=todo

\`\`\`
open(
  type="todo",
  description="…"             // 待办内容
)
\`\`\`

行为：创建一个 todo form，分配 form_id。该 form 持续出现在 activeForms 中，直到 LLM 显式 \`submit(form_id)\` 标记完成。
详见 thinkable/context 的 "TODO 作为 form" 段落。

## 通用参数

任意 \`open\` 调用都可携带：

- \`mark\` — 标记 inbox 消息（详见 [mark](./mark.doc.js)）

## 返回

\`open\` 总是返回 \`{ form_id: string }\`。后续 refine/submit/close 都需引用这个 form_id。
`,
};
