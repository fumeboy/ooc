import { commands_v20260506_1 } from "@meta/object/executable/actions/commands/index.doc";

export const plan_v20260506_1 = {
    parent: commands_v20260506_1,
    index: `
\`plan\` 用于设置或更新当前线程的计划文本。

## 调用形式

\`\`\`
open(type=command, command=plan, description="…")
refine(form_id, {
  text: "…"                  // 必填，新的计划文本（覆盖式更新）
})
submit(form_id)
\`\`\`

## 行为

- 把 text 写入 \`threadData.plan\`
- 在 process events 中追加一条 plan 事件
- 下一轮 Context 中，plan 字段呈现新的文本

plan 是**线程局部**的——同对象的其他线程看不见本线程的 plan。
plan 也不会自动同步给父线程；要让父知道，需通过子线程完成后 \`talk(target=creator, ...)\` 携带。

## Path 列表

\`\`\`
plan
\`\`\`

## 触发的 knowledge

激活 \`kernel:plannable\`（show_content_when 含 \`do\` / \`plan\`）。
描述如何写好 plan：粒度、与 todo form 的协作、何时该 update 等。

## plan vs todo form

| 维度 | plan | todo form |
|---|---|---|
| 形态 | 一段自由 markdown 文本 | 多个独立的 form，每个 form 是一项待办 |
| 粒度 | 整体战略 | 单步行动 |
| 修改 | submit plan command 整体覆盖 | 每个 todo form 独立 open / submit |
| 持久 | 写入 threadData.plan | 持续出现在 activeForms 直到逐项 submit |

实践：用 plan 写整体思路与阶段，用 todo form 跟踪具体可执行项。
`,
};
