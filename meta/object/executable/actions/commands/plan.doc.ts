import type { Concept, DocNode } from "@meta/doc-types";
import { commands_v20260506_1 } from "@meta/object/executable/actions/commands/index.doc";
import * as planSource from "@src/executable/windows/root/plan";

/* ────────────────────────────────────────────────────────────────
 *  目录页：root.plan command 的全貌
 * ──────────────────────────────────────────────────────────────── */

/**
 * Plan 概念：设置或更新当前线程的计划文本。
 *
 * sources:
 *  - plan — root.plan command 实现
 */
export type PlanConcept = Concept & {
  sources: { plan: typeof planSource };

  /** open / refine / submit 三步调用形态 */
  callShape: DocNode;

  /** 写入 context 与线程局部性 */
  behavior: {
    title: string;
    summary?: string;
    writeToContext: DocNode;
    threadLocal: DocNode;
  };

  /** plan 与 todo command form 的对比 */
  planVsTodo: DocNode;
};

/* ────────────────────────────────────────────────────────────────
 *  数据填充
 * ──────────────────────────────────────────────────────────────── */

export const plan_v20260506_1: PlanConcept = {
  name: "Plan",
  get parent() {
    return commands_v20260506_1;
  },
  sources: { plan: planSource },
  description: "plan 设置或更新当前线程的计划文本。",

  callShape: {
    title: "调用形态",
    content: `
\`\`\`
open(type=command, command=plan, title="…", description="…")
refine(form_id, {
  plan: "…"                  // 必填，新的计划文本（覆盖式更新）
})
submit(form_id)
\`\`\`
    `.trim(),
  },

  behavior: {
    title: "行为",
    summary: "写入 thread.plan + 线程局部",

    writeToContext: {
      title: "写入 context",
      content: "submit 把 plan 文本写入 thread.plan，进入 XML system context 的稳定字段。",
    },

    threadLocal: {
      title: "线程局部性",
      content: `
plan 是**线程局部**的——同对象的其他线程看不见本线程的 plan。
plan 也不会自动同步给父线程。
      `.trim(),
    },
  },

  planVsTodo: {
    title: "plan vs todo",
    summary: "plan 是整体战略；todo 是单步行动",
    content: `
| 维度 | plan | todo command form |
|---|---|---|
| 形态 | 一段自由 markdown 文本 | 多个独立的 form，每个 form 是一项待办 |
| 粒度 | 整体战略 | 单步行动 |
| 修改 | submit plan command 整体覆盖 | 每个 todo form 独立 open / refine / submit |
| 持久 | 持久写入 context（thread.plan 字段） | 表现为 todo_window 持续挂在 contextWindows 中，直到 close |
    `.trim(),
  },
};
