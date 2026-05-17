import { commands_v20260506_1 } from "@meta/object/executable/actions/commands/index.doc";
import * as planSource from "@src/executable/windows/root/plan";

export const plan_v20260506_1 = {
  get parent() { return commands_v20260506_1; },
  name: "Plan",
  sources: { plan: planSource },
  description: `
plan 设置或更新当前线程的计划文本。

按子字段展开：

- callShape — open / refine / submit 三步调用形态
- behavior — 写入 context 与线程局部性
- planVsTodo — plan 与 todo command form 的对比
`,

  callShape_v20260517_1: {
    title: "call Shape",
    content: `

open(type=command, command=plan, title="…", description="…")
refine(form_id, {
  plan: "…"                  // 必填，新的计划文本（覆盖式更新）
})
submit(form_id)

    `,
  },

  behavior_v20260517_1: {
    title: "behavior",
    content: `
plan 的写入与作用域。
    `,

    writeToContext_v20260517_1: {
      title: "写入 context",
      content: `
submit 把 plan 文本写入 thread.plan，进入 XML system context 的稳定字段。
      `,
    },

    threadLocal_v20260517_1: {
      title: "线程局部性",
      content: `
plan 是**线程局部**的——同对象的其他线程看不见本线程的 plan。
plan 也不会自动同步给父线程。
      `,
    },
  },

  planVsTodo_v20260517_1: {
    title: "plan Vs Todo",
    content: `
| 维度 | plan | todo command form |
|---|---|---|
| 形态 | 一段自由 markdown 文本 | 多个独立的 form，每个 form 是一项待办 |
| 粒度 | 整体战略 | 单步行动 |
| 修改 | submit plan command 整体覆盖 | 每个 todo form 独立 open / refine / submit |
| 持久 | 持久写入 context（thread.plan 字段） | 表现为 todo_window 持续挂在 contextWindows 中，直到 close |
    `,
  },
};
