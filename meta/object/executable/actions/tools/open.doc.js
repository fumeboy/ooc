import { tools_v20260506_1 } from "@meta/object/executable/actions/tools/index.doc";

export const open_v20260506_1 = {
  parent: tools_v20260506_1,
  index: `
\`open\` 用于
- 开始一次行动
- 加载一个资源到 Context
- 创建一个 todo item

具有 type 参数，按 \`type\` 分支处理：

| type | 用途 | 是否产生 form |
|---|---|---|
| command   | 开始一次 command 调用，分配 form_id | 是 |
| knowledge | 显式打开一篇 knowledge，让其进入 Context | 否 |
| file      | 把一个文件的内容注入 Context | 否 |
| todo      | 创建一项待办 | 是 |

## type=command

\`\`\`
open(
  type="command",
  command="program",        // 必填，目标 command 名（详见 actions/commands）
  title="...",              // 为本次行动提供一个标题
  description="…",          // 简短说明本次行动的意图
  args?: {...}              // 可选；等价于 open + refine(args)
)
\`\`\`

行为：
1. 创建 form，分配 form_id
2. 根据 command 和 args 得到激活的 command path 路径集合
3. 激活路径对应的 knowledge（activates_on.show_content_when 或者 activates_on.show_description_when 命中）进入 Context
4. 返回 form_id，供后续 refine / submit / close 引用。

## type=knowledge

\`\`\`
open(
  type="knowledge",
  description="想看 file_ops 的完整 API",
  args?: {
      path:"path/computable/file_ops",     // 必填，knowledge filepath
      lines?: [0, 200],           // 可选，行号窗口, 默认 200 行，[0, -1] 表示全文
      columns?: [0, 200]           // 可选，每行最多展示多少字符，默认 200 字符，[0, -1] 表示全行
  }
)
\`\`\`

行为：
- activateKnowledge + pinKnowledge：knowledge 进入 \`activatedKnowledge\` 与 \`pinnedKnowledge\` 两个列表
- 该 knowledge 完整正文注入 Context
- pinned 的 knowledge **不**会因为其他 form submit/close 自动卸载，只能通过 \`close(type=knowledge, name=...)\` 显式 unpin

适用场景：临时想查阅某篇 knowledge 全文，与当前 form 的 command 无关。

## type=file

和 knowledge 一致的模式:
\`\`\`
open(
  type="file",
  description="…",
  args?: {
      path:"path/computable/file_ops",     // 必填, filepath
      lines?: [0, 200],           // 可选，行号窗口, 默认 200 行，[0, -1] 表示全文
      columns?: [0, 200]           // 可选，每行最多展示多少字符，默认 200 字符，[0, -1] 表示全行
  }
)
\`\`\`

## type=todo

\`\`\`
open(
  type="todo",
  title: "todo title",
  description="…"             // 待办内容
)
\`\`\`

行为：创建一个 todo form，分配 form_id。该 form 持续出现在 activeForms 中，直到 LLM 显式 \`submit(form_id)\` 或者 \`close(form_id)\` 标记完成。
详见 thinkable 文档。

## 通用参数

任意 \`open\` 调用都可携带：

- \`mark\` — 标记 inbox 消息（详见 [mark](./mark.doc.js)）

## 返回

\`open\` 总是返回 \`{ form_id: string }\`。后续 refine/submit/close 都需引用这个 form_id。
`,
};
