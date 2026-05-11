import { commands_v20260506_1 } from "@meta/object/executable/actions/commands/index.doc";
import * as planSource from "@src/executable/commands/plan";

export const plan_v20260506_1 = {
  get parent() { return commands_v20260506_1; },
  index: `
\`plan\` 用于设置或更新当前线程的计划文本。

## 调用形式

\`\`\`
open(type=command, command=plan, title="…", description="…")
refine(form_id, {
  plan: "…"                  // 必填，新的计划文本（覆盖式更新）
})
submit(form_id)
\`\`\`

## 行为

- 把 plan 写入 context

plan 是**线程局部**的——同对象的其他线程看不见本线程的 plan。
plan 也不会自动同步给父线程

## plan vs todo command form

| 维度 | plan | todo command form |
|---|---|---|
| 形态 | 一段自由 markdown 文本 | 多个独立的 form，每个 form 是一项待办 |
| 粒度 | 整体战略 | 单步行动 |
| 修改 | submit plan command 整体覆盖 | 每个 todo form 独立 open / refine / submit |
| 持久 | 持久写入 context | 出现在 context 的 activeForms 直到 todo form 被 submit/close |
`,
  sources: {
    plan: planSource,
  },
};
