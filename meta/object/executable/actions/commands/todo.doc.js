import { commands_v20260506_1 } from "@meta/object/executable/actions/commands/index.doc";
import * as todoSource from "@src/executable/commands/todo";

export const todo_v20260509_1 = {
  get parent() { return commands_v20260506_1; },
  index: `
\`todo\` 用于登记一个可见待办，并可选配置在命中特定 command 或 command path 时提醒。

## 调用形式

\`\`\`
open(type=command, command=todo, description="登记一个后续待办")
refine(form_id, {
  content: "补充 program 的真实链路测试",   // 必填，待办内容
  on_command_path?: ["program", "program.function"]   // 可选，命中这些 command 或 command path 时提醒
})
submit(form_id)
\`\`\`

## 行为

1. 该待办作为一个普通 command form 出现在 \`activeForms\` 中
2. 未配置 \`on_command_path\` 时，它就是一个普通的可见待办
3. 配置了提醒条件后，待办依旧保持可见；命中对应 command/path 时，系统可额外把提醒文本注入 Context

## 运行时语义

todo 的可见性来自 \`activeForms\`：

- \`open(command=todo)\` 后，form 出现在 \`activeForms\`，表示待办未完成
- \`refine(form_id, ...)\` 更新待办内容和触发条件
- \`submit(form_id)\` 把 form 标记为 executed，表示待办已处理
- \`close(form_id, reason)\` 才会真正把该 todo 从 \`activeForms\` 中移除

当前实现里，todo command 本身没有额外执行逻辑；它的“存在感”和“完成感”完全由 form 生命周期表达。

## Path 列表

\`\`\`
todo
todo.on_command_path
\`\`\`

## 设计意图

- 用一个概念同时表达"常驻待办"与"条件提醒"
- 让待办始终可见，避免提醒逻辑脱离当前上下文
`,
  sources: {
    todo: todoSource,
  },
};
