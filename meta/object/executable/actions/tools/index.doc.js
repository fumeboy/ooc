import { executable_v20260504_1 } from "@meta/object/executable/index.doc";
import * as toolsSource from "@src/executable/tools/index";

// parent 改为 getter 以打破 executable/index ↔ tools/index 的循环初始化死锁。
// executable/index.doc.js 在顶层 import 本模块，此时 executable_v20260504_1 尚未赋值；
// 用 getter 让消费方按需访问，避开 ReferenceError。
export const tools_v20260506_1 = {
  get parent() { return executable_v20260504_1; },
  index: `
Tools 是 LLM 在每一轮 ThinkLoop 中可以直接调用的原语集合。

OOC 把"行动"建模为这些原语：

| 原语 | 作用 |
|---|---|
| open    | 打开一次行动的入口（开启 form / 加载 knowledge / 加载 file） |
| refine  | 累积 / 修改 form 参数（不执行） |
| submit  | 提交 form，触发对应 command 执行 |
| close   | 取消 form |
| wait    | 放弃当前思考循环，等待新事件 |
| compress | 压缩本线程的 process events |

通用附加参数：
- mark — 任意 tool 调用都可以携带 mark 参数，用来标记 inbox 消息已读（ack / ignore / todo）
- deps - 任意 tool 调用都可以携带 deps 参数，用于声明执行这个 tool 时是基于哪些信息而作出的决定

LLM 永远只面向这些 tool；具体能"做什么"由 open 时携带的 command 决定
（program / talk / do / plan / todo / end 等，详见 actions/commands）。

## 原语 + form 的关系

\`\`\`
open(type=command, command=X, ...)   →  FormManager.open(command=X)
                                          ↓
                                       form 进入活跃状态（status=open）
                                       根据 command 路径激活相关 knowledge
refine(form_id, form_args)           →  FormManager.refine(formId, form_args)
                                          ↓
                                       累积参数；若 args 触发新的 command 路径，
                                       增量激活对应 knowledge
submit(form_id, ...)                 →  FormManager.submit(formId)
                                          ↓
                                       form 状态切到 executing（仍在 active_forms）
                                       executeCommand(form.command, finalArgs)
                                       FormManager.markExecuted(formId, result)
                                       form 状态切到 executed，result 进入 context
                                       （form 不自动关闭，由 LLM 显式 close）
close(form_id, reason)               →  FormManager.close(formId)
                                          ↓
                                       form 真正离开 active_forms（任何状态都可关）
                                       非 pinned 的 knowledge 自动卸载
wait()                               →  setNodeStatus("waiting")
                                          ↓
                                       本线程让出调度权，直到新事件到达
\`\`\`

当前协议还要补两点：

- \`refine\` 的业务参数真实字段名是 \`form_args\`，不是文档中早期常写的顶层 \`args\`。
- \`submit\` 的 schema 不接受新的业务参数；但运行时内部仍会把 tool 顶层参数（如 \`title\` / \`mark\`）并入最终执行参数，因此 command 实现需要自己区分“业务参数”和“tool 元参数”。

详见各 tool 的独立文档：
- [open](./open.doc.js) / [refine](./refine.doc.js) / [submit](./submit.doc.js) / [close](./close.doc.js) / [wait](./wait.doc.js) / [compress](./compress.doc.js)
- [mark](./mark.doc.js) — 附加在任意 tool 上的 inbox 标记

## form 在上下文中的表示

Step 1（spec 2026-05-14）后 form 改名为 \`command_exec window\`，是 ContextWindow 的一种 type。
每个 open 创建的 command_exec form 都会出现在 \`thread.contextWindows\` 中（详见 thinkable/context），
让 LLM 看到自己手头还挂着哪些行动。

submit 成功后该 form **自动从 contextWindows 移除**，无需 close；失败时保留 \`status=executed\` + \`result\`，等 LLM 显式 close。

注：todo 不走 \`open → refine → submit\` 三步——\`open(command="todo", title=..., args={ content })\`
在 args 给齐时 open 立即提交 form，产出独立的 \`todo_window\`；完成时 \`close(window_id="<todo_window_id>")\`。
`,
  sources: {
    tools: toolsSource,
  },
};
