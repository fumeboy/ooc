import { commands_v20260506_1 } from "@meta/object/executable/actions/commands/index.doc";
import * as endSource from "@src/executable/windows/root/end";

export const end_v20260506_1 = {
  get parent() { return commands_v20260506_1; },
  name: "End",
  sources: { end: endSource },
  description: `
end 主动标记本线程已完成。

按子字段展开：

- callShape — 调用形态
- behavior — 状态切换与 end 字段写入
- notADeath — done 状态下收到新消息会翻回 running
- noMessage — end 不发送任何消息
- waitComparison — 与 wait 的语义对比
`,

  callShape_v20260517_1: {
    index: `

open(type=command, command=end, title="…", description="…", args={reason: "…"})
submit(form_id)

`,
  },

  behavior_v20260517_1: {
    index: `
end 触发两件事：状态切换 + 填充 end 字段。
`,

    statusTransition_v20260517_1: {
      index: `
### status: running → done

当前线程 status 切到 done；thinkloop 不再驱动它。
`,
    },

    endFields_v20260517_1: {
      index: `
### end 字段

- endReason：这次结束的原因
- endSummary：留给父线程或后续恢复阅读的总结

scheduler 在 await_children 唤醒父线程时，会优先读取这些字段拼接子线程完成摘要。
`,
    },
  },

  notADeath_v20260517_1: {
    index: `
### end 不是死亡

done 状态下若收到任何新 inbox 消息，线程自动翻回 running。
end 表达"本线程任务完结，若有新情况可再来找我"，不是永久终止。
`,
  },

  noMessage_v20260517_1: {
    index: `
### end 不发送任何消息

end 只是状态切换；不会向 creator 报告"我做完了"。
子线程完成后给父线程报告应该用 talk(target=creator, ...)，再视情况 end。
`,
  },

  waitComparison_v20260517_1: {
    index: `
### 与 wait 的对比

| 命令 | 状态 | 表达的意思 |
|---|---|---|
| wait | waiting | 我的工作还没完结，但是我需要等待更多信息输入 |
| end  | done    | 我认为本线程的任务已完结；若有新情况可以再来找我 |
`,
  },
};
