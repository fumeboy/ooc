import { commands_v20260506_1 } from "@meta/object/executable/actions/commands/index.doc";
import * as todoSource from "@src/executable/windows/root/todo";

export const todo_v20260514_1 = {
  get parent() { return commands_v20260506_1; },
  index: `
\`todo\` 用于登记一个可见待办，提交后产出一个 todo_window 持久挂在当前 thread 的 contextWindows。

## 调用形式

\`\`\`
open(command="todo", title="登记后续待办", args={
  content: "补充 program 的真实链路测试",   // 必填，待办内容
  on_command_path?: ["program", "program.function"]   // 可选
})
\`\`\`

> args 给齐时 open 立即提交 form；不需要再显式调 refine / submit。

## 行为（Step 1 新模型 — spec 2026-05-14）

1. submit 副作用：在 thread.contextWindows 下挂一个 type=todo 的 window
2. 该 todo_window 没有 LLM 可调用的 command
3. 完成或撤销：\`close(window_id="<todo_window_id>", reason="...")\`
4. command_exec form 在 submit 成功后自动从 contextWindows 移除（spec § submit）

## Path 列表

\`\`\`
todo
todo.on_command_path
\`\`\`

## 与旧实现的差异

旧版本中 todo "永远不 submit"——用 form 的 open 状态表达"未完成"。
Step 1 之后 todo_window 是独立 window 类型，不再借助 command_exec form 的生命周期表达可见性，
契合统一的 ContextWindow 模型。
`,
  sources: {
    todo: todoSource,
  },
};
