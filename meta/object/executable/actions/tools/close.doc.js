import { tools_v20260506_1 } from "@meta/object/executable/actions/tools/index.doc";

export const close_v20260506_1 = {
  parent: tools_v20260506_1,
  index: `
\`close\` 用于关闭一个已 open 的 form

\`\`\`
close(
  form_id="…",               // 必填
  reason="…"                 // 必填，简短解释为什么关闭
)
\`\`\`

reason 为什么必填：避免 LLM 反复 open → close → open → close 振荡而不留下原因；
reason 帮助下一轮 LLM 理解"上一轮我为什么放弃了这个行动"。
`,
};
