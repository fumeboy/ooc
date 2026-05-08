import { tools_v20260506_1 } from "@meta/object/executable/actions/tools/index.doc";

export const defer_v20260506_1 = {
  parent: tools_v20260506_1,
  index: `
\`defer\` 是一个特殊的 command（通过 \`open(type=command, command=defer, title="…", description="…", ...)\` 触发），
用于注册"在某个 command 被 open 时，向 Context 注入一段提醒文本"的 hook。

defer 是 OOC 中**唯一**的 hook 机制。

## 调用形式

\`\`\`
open(type=command, command=defer, description="…")
refine(form_id, {
  on_command="program",       // 必填，监听哪个 command 的 submit
  content="…"                 // 必填，on_command 对应的 form open 时注入到 Context 的提醒文本
})
submit(form_id)
\`\`\`

## 行为

1. submit 时把一条 defer 记录写入当前线程的 \`defers\` 列表（详见 thinkable/context 的 defers 字段）
2. 之后任何时刻，本线程内任意 \`submit(form_id)\` 触发某 command 执行时：
   - 系统检查当前线程的 defers 列表
   - 命中 on_command 的所有 defer 把 content 注入 Context（作为 process events 中的 inject 消息）
3. defer 在线程 \`end\` 后自动清除——defer 的生命周期 = 线程级

## 仅支持 hook command 事件

defer 只监听 command 的 open 时刻（command 事件）。
不支持监听其他事件类型（消息到达、状态切换、错误发生等）。

## 典型用例

### 自我提醒做某件事的"前置检查"

\`\`\`
defer({ on_command: "talk", content: "请先确认 issue 状态再 talk supervisor" })
\`\`\`

之后任何 submit talk 之前，LLM 都会看到提醒。

### 跨多步行动维持注意力

\`\`\`
defer({ on_command: "program", content: "记得本次任务的 sandbox 限制：不能写 /etc" })
\`\`\`

让某个约束持续提醒，避免几轮后被遗忘。

## 工作收尾

defer({ on_command: "end", content: "记得回收任务资源 ..." })
`,
};
