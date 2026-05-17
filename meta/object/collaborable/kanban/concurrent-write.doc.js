import * as flowObject from "@src/persistable/flow-object";
import * as threadJson from "@src/persistable/thread-json";
import { kanban_v20260506_1 } from "@meta/object/collaborable/kanban/index.doc";

/**
 * ConcurrentWrite 概念：kanban 数据多方并发写入的串行化保护。
 *
 * sources（保护对象是 flow 目录下的 JSON 文件）:
 *  - flowObject — flows/{sid}/objects/{id}/ 目录骨架，承载 issues/ tasks/ 子树
 *  - threadJson — thread.json 读写，是同类串行化保护的另一个使用点
 */
export const concurrent_write_v20260506_1 = {
  name: "ConcurrentWrite",
  get parent() { return kanban_v20260506_1; },
  sources: {
    flowObject,
    threadJson,
  },
  description: `
Kanban 数据可能被多方并发写入。通过 per-key 串行化队列（SerialQueue）
保护读-改-写竞态。

按子字段展开（见各子字段）：

- writers — 三类潜在写入方
- raceCondition — 没有保护会发生的丢失更新
- serialQueue — SerialQueue 工具接口与设计要点
- keyChoice — 看板写入的 key 选择
- indexSync — index.json 与单条文件的原子同步
- failure — 任务失败时队列的行为
- performance — 串行化的性能权衡
- otherUsers — 系统其他使用 SerialQueue 的场景
- limits — SerialQueue 不解决的问题（进程崩溃半写）
`.trim(),

  writers_v20260517_1: {
    index: `
## 三类潜在写入方

| 写入方 | 通过什么 |
|---|---|
| supervisor | \`session-kanban\` 专属 server 模块（详见 collaborable/role/supervisor）|
| 其他 Object | talkable 下 issue-discussion 相关 server 方法（仅评论 / 讨论）|
| user | 后端 HTTP API（如 \`POST /api/sessions/{sid}/issues/{id}/comments\`）|
`.trim(),
  },

  raceCondition_v20260517_1: {
    index: `
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
`.trim(),
  },

  serialQueue_v20260517_1: {
    index: `
## SerialQueue：per-key 串行化

通用 \`SerialQueue<K>\` 工具：同 key 任务按 FIFO 串行；不同 key 互不阻塞。

\`\`\`typescript
class SerialQueue<K = string> {
  enqueue<T>(key: K, fn: () => Promise<T>): Promise<T>;
}
\`\`\`

设计要点：

- **错误隔离**：一个任务 reject 不污染同 key 后续任务
- **返回值透传**：泛型保留 fn 的返回类型
- **自然 GC**：内部只维护当前链尾 Promise
`.trim(),
  },

  keyChoice_v20260517_1: {
    index: `
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

读-改-写三步在队列的一次回合中原子完成；其他并发写入排队等待。
`.trim(),
  },

  indexSync_v20260517_1: {
    index: `
## index.json 与单条文件的同步

修改单条 Issue / Task 时通常也要更新 \`index.json\`。
写入函数把"完整列表 + 单条文件"作为一个 enqueue 内的批操作完成——
串行化保证不会出现 index 与单条文件不一致的中间态。
`.trim(),
  },

  failure_v20260517_1: {
    index: `
## 失败处理

enqueue 的 fn 抛错时：

- 错误向上抛（调用方处理）
- 队列继续（下一个写入正常执行——链尾被 \`.catch(() => {})\` 包装吞错）
- 文件保持抛错前的状态（如果抛错发生在读后、写前，文件未改）
`.trim(),
  },

  performance_v20260517_1: {
    index: `
## 性能

串行化看似慢，实际：

- 同一 key 的并发写必须串行化（数据正确性 > 速度）
- 不同 key 的并发写不相互等待
- 看板写入频率通常不高（每分钟几十次量级）
`.trim(),
  },

  otherUsers_v20260517_1: {
    index: `
## 其他使用 SerialQueue 的场景

| 场景 | key |
|---|---|
| ThreadsTree 写 threads.json | 单 key（每个 ThreadsTree 实例一个 SerialQueue）|
| 用户 inbox 写入（user/data.json）| sessionId |
| super 分身目录写入 | stoneName |

每个上层调用点根据自身领域边界选 key。
`.trim(),
  },

  limits_v20260517_1: {
    index: `
## 不解决的问题：原子写入

SerialQueue 解决并发竞态，不解决进程崩溃中途的"半写文件"。
写文件用 \`Bun.write\` 直接写，不是 tmpfile + rename 模式。

如需进程崩溃保护，调用方可在 enqueue 内加 tmp+rename 包装；
系统认为崩溃中途的概率足够低，配合 git 历史可恢复。
`.trim(),
  },
};
