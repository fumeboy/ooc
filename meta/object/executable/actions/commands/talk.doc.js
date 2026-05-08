import { commands_v20260506_1 } from "@meta/object/executable/actions/commands/index.doc";

export const talk_v20260506_1 = {
  parent: commands_v20260506_1,
  index: `
\`talk\` 用于向另一个 Object 发送消息。

## 调用形式

\`\`\`
open(type=command, command=talk, title="…", description="…")
refine(form_id, {
  target:    "user" | "super" | "creator",  // 必填
  msg:       "…",                                              // 必填
  context?:  "fork" | "continue",                      // 可选，默认 fork
  threadId?: "…",                                              // context=fork/continue 时使用, 可选，默认目标 object 的 root thread
  type?:     "relation_update" | "question_form",              // 可选语义类型
  wait?:     true | false,                                     // 是否同步等待对方回复
  question_form?:     {...}                                             // 可选，结构化问题表单,type = question_form 时需要
})
submit(form_id)
\`\`\`

## target 的取值

| target | 含义 |
|---|---|
| \`<对象名>\` | 给某个 Object 发消息（其 Flow 自动创建于同一 Session）|
| \`creator\` | 当前 thread 的创建方 |
| \`super\` | 投递给自己的反思分身（详见 reflectable 文档）|

## context 模式

| context | 含义 | 行为 |
|---|---|---|
| fork      | 在对方某条已有线程下派生子线程 | 需 threadId；新建 child，msg 入 child inbox |
| continue  | 向对方某条已有线程追加消息 | 需 threadId；msg 入该线程 inbox（done 状态会自动翻回 running）|

## wait 行为

- \`wait=false\`（默认）：talk 投递后立即返回，本线程继续 running
- \`wait=true\`：talk 投递后本线程进入 waiting，waitingType=talk_sync；

## type=relation_update / question_form

- \`relation_update\`：通知对方"我们之间的关系信息有变更，请处理"。详见 collaborable/relation。
- \`question_form\`：携带一份结构化问题表单（option picker），让对方在回复时可以快速选择而不只是写自由文本。

## Path 列表

\`\`\`
talk
talk.fork
talk.continue
talk.wait
talk.relation_update
talk.question_form
\`\`\`

## 错误情形

- target 缺失或等于 self（自言自语）：注入 inject 错误事件，本次 talk 不发送
- target 是不存在的对象：onTalk 路由层会处理（可能创建新对象 / 报错）

## 特殊处理

user （系统人类用户）是特殊的 object, user 可以参与消息交互，但是 user 的 thread 不由系统调度执行
`,
};
