import { executable_v20260504_1 } from "@meta/object/executable/index.doc";

export const tools_v20260506_1 = {
    parent: executable_v20260504_1,
    index: `
Tools 是 LLM 在每一轮 ThinkLoop 中可以直接调用的原语集合。

OOC 把"行动"建模为五个原语 + 一个附加参数：

| 原语 | 作用 |
|---|---|
| open    | 打开一次行动的入口（开启 form / 加载 knowledge / 加载 file） |
| refine  | 累积 / 修改 form 参数（不执行） |
| submit  | 提交 form，触发对应 command 执行 |
| close   | 取消 form / 卸载已加载资源 |
| wait    | 放弃当前思考循环，等待新事件 |

附加参数：
- mark — 任意 tool 调用都可以携带 mark 参数，用来标记 inbox 消息（ack / ignore / todo）

LLM 永远只面向这 5 个 tool；具体能"做什么"由 submit 时携带的 command 决定
（program / talk / do / plan / defer / compress / end 等，详见 actions/commands）。

## 五原语 + form 的关系

\`\`\`
open(type=command, command=X, ...)   →  FormManager.begin(formId, command=X)
                                          ↓
                                       form 进入活跃状态
                                       根据 command 路径激活相关 knowledge
refine(form_id, args)                →  FormManager.applyRefine(formId, args)
                                          ↓
                                       累积参数；若 args 触发新的 command 路径，
                                       增量激活对应 knowledge
submit(form_id, ...)                 →  FormManager.submit(formId)
                                          ↓
                                       executeCommand(form.command, finalArgs)
                                       form 关闭；非 pinned 的 knowledge 自动卸载
close(form_id)                       →  FormManager.cancel(formId)
                                          ↓
                                       form 关闭，无执行
                                       非 pinned 的 knowledge 自动卸载
wait()                               →  setNodeStatus("waiting")
                                          ↓
                                       本线程让出调度权，直到新事件到达
\`\`\`

详见各 tool 的独立文档：
- [open](./open.doc.js) / [refine](./refine.doc.js) / [submit](./submit.doc.js) / [close](./close.doc.js) / [wait](./wait.doc.js)
- [mark](./mark.doc.js) — 附加在任意 tool 上的 inbox 标记
- [defer](./defer.doc.js) — 注册 command hook（特殊 command，机制最接近"系统级 tool"）

## form 是行动的暂存格

form 让"复杂行动可分步填写"——LLM 不必一次填全所有参数，可以：

1. open(type=command, command=program, description="想运行一段脚本")
   → 此时只声明意图，激活 computable knowledge，让 LLM 看到完整 API 后再决定细节
2. refine(form_id, { code: "..." })
   → 填入代码（也可以分多次 refine 累积）
3. submit(form_id)
   → 真正执行

每个未关闭的 form 都会出现在 Context 的 activeForms 字段（详见 thinkable/context），
让 LLM 看到自己手头还挂着哪些行动。

注：todo 也通过 form 表示——\`open(type=todo, ...) → refine → submit\` 完成一项待办。
新建线程时系统会自动注入一份"处理初始消息"的 todo form 作为入口锚点。
`,
};
