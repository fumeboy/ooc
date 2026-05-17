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
`,

  writers: {
    title: "三类潜在写入方",
    content: `
| 写入方 | 通过什么 |
|---|---|
| supervisor | session-kanban 专属 server 模块（详见 collaborable/role/supervisor）|
| 其他 Object | talkable 下 issue-discussion 相关 server 方法（仅评论 / 讨论）|
| user | 后端 HTTP API（如 POST /api/sessions/{sid}/issues/{id}/comments）|
    `,
  },

  raceCondition: {
    title: "没有保护会发生什么",
    content: `

A 读 issue-001.json
B 读 issue-001.json
A 在 comments 中加一条
A 写回
B 在 comments 中加一条（基于之前读的版本）
B 写回  ← A 的 comment 丢失


经典的"丢失更新"问题。
    `,
  },

  serialQueue: {
    title: "SerialQueue：per-key 串行化",
    content: `
通用 SerialQueue<K> 工具：同 key 任务按 FIFO 串行；不同 key 互不阻塞。
详见三个子节点：接口签名、并发语义、三条设计要点。
    `,

    signature: {
      title: "接口签名",
      content: `
typescript
class SerialQueue<K = string> {
  enqueue<T>(key: K, fn: () => Promise<T>): Promise<T>;
}

      `,
    },

    concurrencySemantics: {
      title: "并发语义",
      content: `
- 同 key 的多次 enqueue 按 FIFO 严格串行
- 不同 key 的 enqueue 互不阻塞，可在不同 microtask 并发执行
- 同一 key 的链条长度只受调用速率影响，无显式上限
      `,
    },

    designPoints: {
      title: "设计要点",
      content: `
- **错误隔离**：一个任务 reject 不污染同 key 后续任务
- **返回值透传**：泛型保留 fn 的返回类型
- **自然 GC**：内部只维护当前链尾 Promise
      `,
    },
  },

  keyChoice: {
    title: "看板写入的 key 选择",
    content: `
key 选 sessionDir——同一 Session 内的 Issue / Task / Comment 写入串行；
不同 Session 互不阻塞。具体见三个子节点：边界依据、调用形态、原子性保证。
    `,

    rationale: {
      title: "边界依据",
      content: `
session 是看板数据的天然隔离边界——issues / tasks / comments 均挂在
flows/{sid}/ 之下。以 sessionDir 为 key 可同时满足"同 session 内串行"
与"跨 session 并行"两条诉求。
      `,
    },

    callShape: {
      title: "调用形态",
      content: `
typescript
const queue = new SerialQueue<string>();
await queue.enqueue(sessionDir, async () => {
  const data = await readFile(...);
  data.comments.push(newComment);
  await Bun.write(..., JSON.stringify(data));
});

      `,
    },

    atomicity: {
      title: "原子性",
      content: `
读-改-写三步在队列的一次回合中原子完成；其他并发写入排队等待。
"原子"指的是逻辑串行，并不是文件系统层 fsync 原子（见 limits 子节点）。
      `,
    },
  },

  indexSync: {
    title: "index.json 与单条文件的同步",
    content: `
修改单条 Issue / Task 时通常也要更新 index.json。详见两个子节点。
    `,

    batchInOneEnqueue: {
      title: "批操作在一次 enqueue 内",
      content: `
写入函数把"完整列表 + 单条文件"作为一个 enqueue 内的批操作完成。两次文件写
不可分割——通过同一个 fn 内部连续 await 实现。
      `,
    },

    noIntermediateState: {
      title: "无不一致中间态",
      content: `
串行化保证不会出现 index 与单条文件不一致的中间态（前端读到 index 说有 3 条
但只能找到 2 条单条文件的情况不会发生）。
      `,
    },
  },

  failure: {
    title: "失败处理",
    content: `
enqueue 的 fn 抛错时的三条规则。每条独立子节点。
    `,

    errorPropagation: {
      title: "错误向上抛",
      content: `
错误透传给调用方处理——SerialQueue 不吞错，调用方 await enqueue(...) 处直接捕获。
      `,
    },

    queueContinues: {
      title: "队列继续",
      content: `
一个任务失败后，下一个写入正常执行——链尾被 .catch(() => {}) 包装吞错，
不会因为一次失败而瘫痪整条 key 的后续写入。
      `,
    },

    fileSnapshotIntact: {
      title: "文件保持抛错前状态",
      content: `
如果抛错发生在读后、写前，文件未改。但若抛错发生在第一次写入与第二次写入之间
（batchInOneEnqueue 内），可能出现部分写入——见 limits 子节点。
      `,
    },
  },

  performance: {
    title: "性能",
    content: `
串行化看似慢，实际：

- 同一 key 的并发写必须串行化（数据正确性 > 速度）
- 不同 key 的并发写不相互等待
- 看板写入频率通常不高（每分钟几十次量级）
    `,
  },

  otherUsers: {
    title: "其他使用 SerialQueue 的场景",
    content: `
| 场景 | key |
|---|---|
| ThreadsTree 写 threads.json | 单 key（每个 ThreadsTree 实例一个 SerialQueue）|
| 用户 inbox 写入（user/data.json）| sessionId |
| super 分身目录写入 | stoneName |

每个上层调用点根据自身领域边界选 key。
    `,
  },

  limits: {
    title: "不解决的问题：原子写入",
    content: `
SerialQueue 解决并发竞态，不解决进程崩溃中途的"半写文件"。
写文件用 Bun.write 直接写，不是 tmpfile + rename 模式。

如需进程崩溃保护，调用方可在 enqueue 内加 tmp+rename 包装；
系统认为崩溃中途的概率足够低，配合 git 历史可恢复。
    `,
  },
};
