import { commands_v20260506_1 } from "@meta/object/executable/actions/commands/index.doc";

export const talk_v20260506_1 = {
    parent: commands_v20260506_1,
    index: `
\`talk\` 用于向另一个 Object 的某个线程（或自己的另一个线程）发送消息。

## 调用形式

\`\`\`
open(type=command, command=talk, description="…")
refine(form_id, {
  target:    "user" | "supervisor" | "super" | "<thread_id>",  // 必填
  msg:       "…",                                              // 必填
  context?:  "fork" | "continue" | "new",                      // 可选，默认 new
  threadId?: "…",                                              // context=fork/continue 时使用
  type?:     "relation_update" | "question_form",              // 可选语义类型
  wait?:     true | false,                                     // 是否同步等待对方回复
  form?:     {...}                                             // 可选，结构化问题表单
})
submit(form_id)
\`\`\`

## target 的取值

| target | 含义 |
|---|---|
| \`<对象名>\` | 给某个 Object 发消息（其 Flow 自动创建于同一 Session）|
| \`<thread_id>\` | 直接给某个具体线程投递消息 |
| \`super\` | 投递给自己的反思镜像分身（详见 reflectable/super-flow）|
| \`creator\` | 投递给本线程的 creator——子线程"完成回报"的标准方式 |

## context 模式

| context | 含义 | 行为 |
|---|---|---|
| new       | 给对方派生新的根线程 | 创建新线程并把 msg 写入其 inbox |
| fork      | 在对方某条已有线程下派生子线程 | 需 threadId；新建 child，msg 入 child inbox |
| continue  | 向对方某条已有线程追加消息 | 需 threadId；msg 入该线程 inbox（done 状态会自动翻回 running）|

## wait 行为

- \`wait=false\`（默认）：talk 投递后立即返回，本线程继续 running
- \`wait=true\`：talk 投递后本线程进入 waiting，waitingType=talk_sync；
  对方在该线程上 talk 回到本线程 inbox 时唤醒

注意：\`talk(target=user, wait=true)\` 自动降级为 wait=false——user 不会"回复"，避免死锁。

## type=relation_update / question_form

- \`relation_update\`：通知对方"我们之间的关系信息有变更，请处理"。详见 collaborable/relation。
- \`question_form\`：携带一份结构化问题表单（option picker），让对方在回复时可以快速选择而不只是写自由文本。

## Path 列表

\`\`\`
talk
talk.fork
talk.continue
talk.new
talk.wait
talk.relation_update
talk.question_form
talk.continue.relation_update
talk.continue.question_form
\`\`\`

## 触发的 knowledge

默认激活 \`kernel:talkable\`（show_content_when 含 \`talk\`）。
当 context / type 命中其他子路径时，对应子 knowledge 自动激活
（如 \`kernel:talkable/relation_update\` 在 \`talk.relation_update\` 路径上）。

## 错误情形

- target 缺失或等于 self（自言自语）：注入 inject 错误事件，本次 talk 不发送
- target 是不存在的对象：onTalk 路由层会处理（可能创建新对象 / 报错）

详见 collaborable/talk。
`,
};
