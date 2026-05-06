import { commands_v20260506_1 } from "@meta/object/executable/actions/commands/index.doc";

export const end_v20260506_1 = {
    parent: commands_v20260506_1,
    index: `
\`end\` 用于主动标记本线程已完成所有可见任务。

## 调用形式

\`\`\`
open(type=command, command=end, description="…")
refine(form_id, {
  reason?: "…"               // 可选，简短说明结束理由
})
submit(form_id)
\`\`\`

## 行为

1. 当前线程 status: running → done
2. 在 process events 写一条 inject 提示，含 reason
3. 本线程从 Scheduler 调度集合中移出
4. 若该线程有未完成的 activeForms / todo form / pinned knowledge，先做清理（释放资源）

## end 不发送任何消息

end 只是状态切换。不会向 creator 报告"我做完了"。
**子线程完成后给父线程报告**应该用 \`talk(target=creator, ...)\`，再视情况 end。

典型流程：

\`\`\`
... 子线程做完事情 ...
talk(target=creator, msg="任务完成，结果是 X")  // 向父汇报
end(reason="本线程任务完结")                     // 标记自己 done
\`\`\`

## end 不是终点

done 状态下若收到任何新 inbox 消息，线程自动翻回 running——
end 只是表达"目前没事可做"，不是"永久关闭"。

要让线程真正不再可被唤醒，需要外部把节点状态强制改为 failed 或删除整个线程目录
（这都是非常规操作）。

## Path 列表

\`\`\`
end
\`\`\`

## 触发的 knowledge

end 通常不需要专门的 knowledge——它的语义已经被 base 协议覆盖。
基座 knowledge 已说明 end 的含义和何时使用。

## 与 wait 的对比

| 命令 | 状态 | 表达的意思 |
|---|---|---|
| \`wait\` | waiting | 我现在没事做，但我知道还会有事 |
| \`end\`  | done    | 我认为本线程的任务已完结；若有新情况可以再来找我 |

实践：
- 当还在等明确的回应（如等子线程返回、等 user 回复）→ wait（其实 do/talk 的 wait=true 更直接）
- 当任务收尾、没明确等待对象 → end
`,
};
