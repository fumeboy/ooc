import { tools_v20260506_1 } from "@meta/object/executable/actions/tools/index.doc";

export const close_v20260506_1 = {
    parent: tools_v20260506_1,
    index: `
\`close\` 用于关闭一个已 open 的 form / 卸载已加载的资源。

\`\`\`
close(
  form_id="…",               // 必填
  reason="…"                 // 必填，简短解释为什么关闭（特别是放弃 command 时）
)
\`\`\`

## 行为

按 form 的 type 分支：

### form 来自 open(type=command)

放弃执行该 command。
- FormManager.cancel 移除 form
- 该 form 引入的 knowledge：若不再被其他活跃 form 命中、且未 pinned，自动 deactivate
- 在 process events 写一条 inject 提示，含 reason

reason 为什么必填：避免 LLM 反复 open → close → open → close 振荡而不留下原因；
reason 帮助下一轮 LLM 理解"上一轮我为什么放弃了这个行动"。

### form 来自 open(type=knowledge)

显式 unpin 该 knowledge。
- 从 \`pinnedKnowledge\` 移除
- 若该 knowledge 不再被任何活跃 form 命中，从 \`activatedKnowledge\` 移除
- 该 knowledge 完整正文不再注入下一轮 Context（其 description 仍可由父 knowledge 间接展示）

### form 来自 open(type=file)

释放文件窗口，文件内容不再注入 Context。

### form 来自 open(type=todo)

通常用 \`submit\` 表示"完成"。\`close\` 表示"放弃这项待办"——也需 reason 说明放弃原因。

## 防震荡保护

引擎检测到连续 ≥5 次 open/close 同一 command 而无 submit 时，
会在 Context 中注入告警，提示 LLM "你在反复 open/close 同一个行动，是不是参数有问题？"

## 通用参数

- \`mark\` — 同 [mark](./mark.doc.js)
`,
};
