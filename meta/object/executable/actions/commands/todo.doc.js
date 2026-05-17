import { commands_v20260506_1 } from "@meta/object/executable/actions/commands/index.doc";
import * as todoSource from "@src/executable/windows/root/todo";

export const todo_v20260514_1 = {
  get parent() { return commands_v20260506_1; },
  name: "Todo",
  sources: { todo: todoSource },
  description: `
todo 登记一个可见待办，提交后产出一个 todo_window 持久挂在当前 thread 的
contextWindows。

按子字段展开：

- callShape — 调用形态与一步直建特性
- submitEffects — submit 副作用与 close 路径
- pathList — root.todo 注册的 command path
- contextWindowModel — todo_window 作为独立 ContextWindow 类型的语义
`,

  callShape_v20260517_1: {
    index: `

open(command="todo", title="登记后续待办", args={
  content: "补充 program 的真实链路测试",                  // 必填，待办内容
  on_command_path?: ["program", "program.function"]      // 可选
})


args 给齐时 open 立即提交 form；不需要再显式调 refine / submit。
on_command_path 用于在指定 command path 激活时把这条 todo 高亮提示给 LLM。
`,
  },

  submitEffects_v20260517_1: {
    index: `
todo 的 submit 触发 4 项规则。
`,

    spawnTodoWindow_v20260517_1: {
      index: `
### 1. 挂 todo_window

submit 副作用：在 thread.contextWindows 下挂一个 type=todo 的 window。
`,
    },

    noLlmCommands_v20260517_1: {
      index: `
### 2. todo_window 无 LLM 可调用的 command

todo_window 是纯展示型——LLM 不能向其 open(parent_window_id=..., command=...) 派生 sub-command。
唯一可做的事情是 close 它。
`,
    },

    closePath_v20260517_1: {
      index: `
### 3. 完成或撤销 → close window

close(window_id="<todo_window_id>", reason="...") 表达"已完成"或"已撤销"。
reason 让下一轮 LLM 理解关闭原因。
`,
    },

    formAutoRemove_v20260517_1: {
      index: `
### 4. command_exec form 自动移除

submit 成功后 command_exec form 自动从 contextWindows 移除；
todo_window 是独立产物，自身的可见性与 form 解耦。
`,
    },
  },

  pathList_v20260517_1: {
    index: `
root.todo 注册的 command path：


todo
todo.on_command_path


todo.on_command_path 仅在 args 包含 on_command_path 时激活，
对应的 knowledge 才会进入 context。
`,
  },

  contextWindowModel_v20260517_1: {
    index: `
todo_window 是独立的 ContextWindow type，可见性不依赖 command_exec form 的生命周期。
这让 todo 与"普通 form 执行后即消失"形成对比——todo 的本质是持久挂件，
直到 LLM 显式 close 才离开 context。
`,
  },
};
