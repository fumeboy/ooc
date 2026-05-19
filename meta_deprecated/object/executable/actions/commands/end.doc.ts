import type { Concept, DocNode } from "@meta/doc-types";
import { commands_v20260506_1 } from "@meta/object/executable/actions/commands/index.doc";
import * as endSource from "@src/executable/windows/root/end";

/* ────────────────────────────────────────────────────────────────
 *  目录页：root.end command 的全貌
 * ──────────────────────────────────────────────────────────────── */

/**
 * End 概念：主动标记本线程已完成。
 *
 * sources:
 *  - end — root.end command 实现
 */
export type EndConcept = Concept & {
  sources: { end: typeof endSource };

  /** 调用形态 */
  callShape: DocNode;

  /** 行为：状态切换 + 填充 end 字段 */
  behavior: {
    title: string;
    summary?: string;
    statusTransition: DocNode;
    endFields: DocNode;
  };

  /** done 状态下收到新消息会翻回 running */
  notADeath: DocNode;

  /** end 不发送任何消息 */
  noMessage: DocNode;

  /** 与 wait 的语义对比 */
  waitComparison: DocNode;
};

/* ────────────────────────────────────────────────────────────────
 *  数据填充
 * ──────────────────────────────────────────────────────────────── */

export const end_v20260506_1: EndConcept = {
  name: "End",
  get parent() {
    return commands_v20260506_1;
  },
  sources: { end: endSource },
  description: "end 主动标记本线程已完成。",

  callShape: {
    title: "调用形态",
    content: `
\`\`\`
open(type=command, command=end, title="…", description="…", args={reason: "…"})
submit(form_id)
\`\`\`
    `.trim(),
  },

  behavior: {
    title: "行为",
    summary: "end 触发两件事：状态切换 + 填充 end 字段",

    statusTransition: {
      title: "status: running → done",
      content: "当前线程 status 切到 done；thinkloop 不再驱动它。",
    },

    endFields: {
      title: "end 字段",
      content: `
- endReason：这次结束的原因
- endSummary：留给父线程或后续恢复阅读的总结

scheduler 在 await_children 唤醒父线程时，会优先读取这些字段拼接子线程完成摘要。
      `.trim(),
    },
  },

  notADeath: {
    title: "end 不是死亡",
    summary: "done 状态下若收到任何新 inbox 消息，线程自动翻回 running",
    content: `
done 状态下若收到任何新 inbox 消息，线程自动翻回 running。
end 表达"本线程任务完结，若有新情况可再来找我"，不是永久终止。
    `.trim(),
  },

  noMessage: {
    title: "end 不发送任何消息",
    summary: "仅状态切换，向 creator 报告应该用 talk 而不是 end",
    content: `
end 只是状态切换；不会向 creator 报告"我做完了"。
子线程完成后给父线程报告应该用 talk(target=creator, ...)，再视情况 end。
    `.trim(),
  },

  waitComparison: {
    title: "与 wait 的对比",
    content: `
| 命令 | 状态 | 表达的意思 |
|---|---|---|
| wait | waiting | 我的工作还没完结，但是我需要等待更多信息输入 |
| end  | done    | 我认为本线程的任务已完结；若有新情况可以再来找我 |
    `.trim(),
  },
};
