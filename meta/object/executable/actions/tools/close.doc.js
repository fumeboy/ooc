import { tools_v20260506_1 } from "@meta/object/executable/actions/tools/index.doc";
import * as closeSource from "@src/executable/tools/close";

export const close_v20260506_1 = {
  get parent() { return tools_v20260506_1; },
  name: "Close",
  get description() { return this.index; },
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

当前 close 的真实边界（Step 1 spec 2026-05-14）：

- 入参：\`window_id\` + \`reason\`（必填）；同时支持 form_id 兼容旧 prompt
- 关闭任意 ContextWindow（command_exec / do / todo）；级联关闭所有 sub-window
- onClose hook：do_window 关闭时归档子线程（B=ii archive）；creator do_window 拒绝 close 并写一条 inject 提示
- command_exec form **成功 submit 后系统自动移除**，不需要显式 close；失败保留，等 LLM 主动 close 释放
- 释放 window 关联的 knowledge 引用计数
`,
  sources: {
    close: closeSource,
  },
};
