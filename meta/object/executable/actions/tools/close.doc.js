import { tools_v20260506_1 } from "@meta/object/executable/actions/tools/index.doc";
import * as closeSource from "@src/executable/tools/close";

export const close_v20260506_1 = {
  get parent() { return tools_v20260506_1; },
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

当前 close 的真实边界也要说明：

- close 只支持关闭 form，不支持关闭 knowledge pin 或 file window。
- form 不论是 \`open\` / \`executing\` / \`executed\` 都可以被 close；close 的效果是把它从 activeForms 真正移除。
`,
  sources: {
    close: closeSource,
  },
};
