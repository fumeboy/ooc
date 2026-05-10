import { executable_v20260504_1 } from "@meta/object/executable/index.doc";
import * as toolsSource from "@src/executable/tools/index";

export const tools_v20260506_1 = {
  parent: executable_v20260504_1,
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
refine(form_id, args)                →  FormManager.refine(formId, args)
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

详见各 tool 的独立文档：
- [open](./open.doc.js) / [refine](./refine.doc.js) / [submit](./submit.doc.js) / [close](./close.doc.js) / [wait](./wait.doc.js) / [compress](./compress.doc.js)
- [mark](./mark.doc.js) — 附加在任意 tool 上的 inbox 标记

## form 在上下文中的表示

每个未关闭的 form 都会出现在 Context 的 activeForms 字段（详见 thinkable/context），
让 LLM 看到自己手头还挂着哪些行动。

注：todo 也通过 form 表示——\`open(type=command, command=todo, ...) → refine(...) → submit\` 完成一项待办。
`,
  sources: {
    tools: toolsSource,
  },
};
