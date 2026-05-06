import { kanban_v20260506_1 } from "@meta/object/collaborable/kanban/index.doc";

export const concurrent_write_v20260506_1 = {
    parent: kanban_v20260506_1,
    index: `
Kanban 数据可能被多方并发写入。
通过 per-key 串行化队列（SerialQueue）保护读-改-写竞态。

## 三个潜在写入方

| 写入方 | 通过什么 |
|---|---|
| supervisor | 拥有 \`session-kanban\` 专属 server 模块（详见 collaborable/role/supervisor）|
| 其他 Object | 通过 talkable 下 issue-discussion 相关 server 方法（仅评论 / 讨论） |
| user | 后端 HTTP API（如 \`POST /api/sessions/{sid}/issues/{id}/comments\`） |

## 没有保护会发生什么

\`\`\`
A 读 issue-001.json
B 读 issue-001.json
A 在 comments 中加一条
A 写回
B 在 comments 中加一条（基于之前读的版本）
B 写回  ← A 的 comment 丢失
\`\`\`

经典的"丢失更新"问题。

## SerialQueue：per-key 串行化

系统提供通用的 \`SerialQueue<K>\` 工具：同 key 任务按 FIFO 串行；不同 key 互不阻塞。

\`\`\`typescript
class SerialQueue<K = string> {
  enqueue<T>(key: K, fn: () => Promise<T>): Promise<T>;
}
\`\`\`

设计要点：
- **错误隔离**：一个任务 reject 不污染同 key 后续任务
- **返回值透传**：泛型保留 fn 的返回类型
- **自然 GC**：内部只维护当前链尾 Promise

## 看板写入的 key 选择

key 选 \`sessionDir\`——同一 Session 内的 Issue / Task / Comment 写入串行；
不同 Session 互不阻塞。

调用方式：

\`\`\`typescript
const queue = new SerialQueue<string>();
await queue.enqueue(sessionDir, async () => {
  const data = await readFile(...);
  data.comments.push(newComment);
  await Bun.write(..., JSON.stringify(data));
});
\`\`\`

读-改-写三步在队列的**一次回合**中原子完成——其他并发写入排队等待。

## index.json 与单条文件的同步

修改单条 Issue / Task 时，通常也要更新 \`index.json\`。
写入函数把"完整列表 + 单条文件"作为一个 enqueue 内的批操作完成——
一旦接入串行化，不会出现 index 与单条文件不一致的中间态。

## 失败处理

enqueue 的 fn 抛错时：

- 错误向上抛（调用方处理）
- 队列继续（下一个写入正常执行——链尾被 \`.catch(() => {})\` 包装吞错）
- 文件保持抛错前的状态（如果抛错发生在读后、写前，文件未改）

## 性能

串行化看起来"慢"，但实际：
- 同一 key 的并发写**必须**串行化（数据正确性 > 速度）
- 不同 key 的并发写**不**相互等待
- 看板写入频率通常不高（每分钟几十次量级），串行完全够用

## 其他使用 SerialQueue 的场景

| 场景 | key |
|---|---|
| ThreadsTree 写 threads.json | 单 key（每个 ThreadsTree 实例一个 SerialQueue）|
| 用户 inbox 写入（user/data.json） | sessionId |
| super 分身目录写入 | stoneName |

每个上层调用点根据自身领域边界选 key。

## 不解决的问题：原子写入

SerialQueue 解决**并发竞态**，但**不**解决进程崩溃中途的"半写文件"。
当前实现写文件用 \`Bun.write\` 直接写，不是 tmpfile + rename 模式。

如需进程崩溃保护，调用方可在 enqueue 内加 tmp+rename 包装；
当前系统未引入这一层（认为崩溃中途的概率足够低，配合 git 历史可恢复）。
`,
};
