import { commands_v20260506_1 } from "@meta/object/executable/actions/commands/index.doc";
import * as endSource from "@src/executable/commands/end";

export const end_v20260506_1 = {
  get parent() { return commands_v20260506_1; },
  index: `
\`end\` 用于主动标记本线程已完成。

## 调用形式

\`\`\`
open(type=command, command=end, title="…", description="…", args={reason: "…"})
submit(form_id)
\`\`\`

## 行为

当前线程 status: running → done

填充 end 字段：
- \`endReason\`：这次结束的原因
- \`endSummary\`：留给父线程或后续恢复阅读的总结

scheduler 在 await_children 唤醒父线程时，会优先读取这些字段拼接子线程完成摘要。

## end 不发送任何消息

end 只是状态切换。不会向 creator 报告"我做完了"。
**子线程完成后给父线程报告**应该用 \`talk(target=creator, ...)\`，再视情况 end。

## end 不是死亡

done 状态下若收到任何新 inbox 消息，线程自动翻回 running

## 与 wait 的对比

| 命令 | 状态 | 表达的意思 |
|---|---|---|
| \`wait\` | waiting | 我的工作还没完结，但是我需要等待更多信息输入 |
| \`end\`  | done    | 我认为本线程的任务已完结；若有新情况可以再来找我 |
`,
  sources: {
    end: endSource,
  },
};
