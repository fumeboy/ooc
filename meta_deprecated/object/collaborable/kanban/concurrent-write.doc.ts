import type { Concept, DocNode, InvariantNode } from "@meta/doc-types";
import { kanban_v20260506_1 } from "@meta/object/collaborable/kanban/index.doc";
import * as flowObject from "@src/persistable/flow-object";
import * as threadJson from "@src/persistable/thread-json";
import * as serialQueue from "@src/persistable/serial-queue";
import * as issueService from "@src/persistable/issue-service";

/* ────────────────────────────────────────────────────────────────
 *  目录页：ConcurrentWrite 概念全貌
 * ──────────────────────────────────────────────────────────────── */

/**
 * ConcurrentWrite 概念：kanban 数据多方并发写入的串行化保护。
 *
 * sources（保护对象是 flow 目录下的 JSON 文件）:
 *  - flowObject  — flows/{sid}/objects/{id}/ 目录骨架,承载 issues/ tasks/ 子树
 *  - threadJson  — thread.json 读写,是同类串行化保护的另一个使用点
 *  - serialQueue — per-key Promise chain 实现(U2);HTTP 与 worker 共用同一模块
 *                 单例,保证同 session 内 createIssue/appendComment/closeIssue
 *                 严格串行
 *  - issueService — 调 enqueueSessionWrite 的具体业务路径(U2)
 *
 * implementation status (2026-05-19): per-session SerialQueue 已落地;多进程
 * 部署需文件锁,留给 follow-up(plan §7 Risk 3)。
 */
export type ConcurrentWriteConcept = Concept & {
  sources: {
    flowObject: typeof flowObject;
    threadJson: typeof threadJson;
    serialQueue: typeof serialQueue;
    issueService: typeof issueService;
  };

  /** 三类潜在写入方 */
  writers: DocNode;

  /** 没有保护会发生的"丢失更新" */
  raceCondition: DocNode;

  /** SerialQueue 工具：接口 / 并发语义 / 设计要点 */
  serialQueue: {
    title: string;
    summary?: string;
    signature: DocNode;
    concurrencySemantics: DocNode;
    designPoints: DocNode;
  };

  /** 看板写入的 key 选择 */
  keyChoice: {
    title: string;
    summary?: string;
    rationale: DocNode;
    callShape: DocNode;
    atomicity: DocNode;
  };

  /** index.json 与单条文件的原子同步 */
  indexSync: {
    title: string;
    summary?: string;
    batchInOneEnqueue: DocNode;
    noIntermediateState: InvariantNode;
  };

  /** 失败处理三规则 */
  failure: {
    title: string;
    summary?: string;
    errorPropagation: DocNode;
    queueContinues: DocNode;
    fileSnapshotIntact: DocNode;
  };

  /** 性能权衡 */
  performance: DocNode;

  /** 系统其他使用 SerialQueue 的场景 */
  otherUsers: DocNode;

  /** 不解决的问题：进程崩溃半写 */
  limits: DocNode;
};

/* ────────────────────────────────────────────────────────────────
 *  数据填充
 * ──────────────────────────────────────────────────────────────── */

export const concurrent_write_v20260506_1: ConcurrentWriteConcept = {
  name: "ConcurrentWrite",
  get parent() {
    return kanban_v20260506_1;
  },
  sources: { flowObject, threadJson, serialQueue, issueService },
  description: `
Kanban 数据可能被多方并发写入。通过 per-key 串行化队列（SerialQueue）保护
读-改-写竞态——同 key 任务按 FIFO 串行，不同 key 互不阻塞。
`.trim(),

  writers: {
    title: "三类潜在写入方",
    summary: "supervisor / 其他 Object / user 三方都可能写入 kanban 数据",
    content: `
| 写入方 | 通过什么 |
|---|---|
| supervisor | session-kanban 专属 server 模块 |
| 其他 Object | talkable 下 issue-discussion 相关 server 方法（仅评论 / 讨论） |
| user | 后端 HTTP API（如 \`POST /api/sessions/{sid}/issues/{id}/comments\`） |
    `.trim(),
  },

  raceCondition: {
    title: "没有保护会发生什么",
    summary: "经典的丢失更新——并发读后各自写回，后写者覆盖先写者",
    content: `
\`\`\`
A 读 issue-001.json
B 读 issue-001.json
A 在 comments 中加一条
A 写回
B 在 comments 中加一条（基于之前读的版本）
B 写回  ← A 的 comment 丢失
\`\`\`
    `.trim(),
  },

  serialQueue: {
    title: "SerialQueue：per-key 串行化",
    summary: "通用 SerialQueue<K> 工具：同 key FIFO 串行，不同 key 互不阻塞",

    signature: {
      title: "接口签名",
      content: `
\`\`\`typescript
class SerialQueue<K = string> {
  enqueue<T>(key: K, fn: () => Promise<T>): Promise<T>;
}
\`\`\`
      `.trim(),
    },

    concurrencySemantics: {
      title: "并发语义",
      content: `
- 同 key 的多次 enqueue 按 FIFO 严格串行
- 不同 key 的 enqueue 互不阻塞，可在不同 microtask 并发执行
- 同一 key 的链条长度只受调用速率影响，无显式上限
      `.trim(),
    },

    designPoints: {
      title: "设计要点",
      content: `
- **错误隔离**：一个任务 reject 不污染同 key 后续任务
- **返回值透传**：泛型保留 fn 的返回类型
- **自然 GC**：内部只维护当前链尾 Promise
      `.trim(),
    },
  },

  keyChoice: {
    title: "看板写入的 key 选择",
    summary: "key = sessionDir：同 session 内串行、跨 session 并行",

    rationale: {
      title: "边界依据",
      content: `
session 是看板数据的天然隔离边界——issues / tasks / comments 均挂在
\`flows/{sid}/\` 之下。以 sessionDir 为 key 同时满足"同 session 内串行"与
"跨 session 并行"两条诉求。
      `.trim(),
    },

    callShape: {
      title: "调用形态",
      content: `
\`\`\`typescript
const queue = new SerialQueue<string>();
await queue.enqueue(sessionDir, async () => {
  const data = await readFile(...);
  data.comments.push(newComment);
  await Bun.write(..., JSON.stringify(data));
});
\`\`\`
      `.trim(),
    },

    atomicity: {
      title: "原子性",
      content: `
读-改-写三步在队列的一次回合中原子完成；其他并发写入排队等待。
这里的"原子"指逻辑串行，并不是文件系统层 fsync 原子（详见 limits）。
      `.trim(),
    },
  },

  indexSync: {
    title: "index.json 与单条文件的同步",
    summary: "批操作放在一次 enqueue 内，不产生不一致中间态",

    batchInOneEnqueue: {
      title: "批操作在一次 enqueue 内",
      content: `
写入函数把"完整列表 + 单条文件"作为一个 enqueue 内的批操作完成。两次文件写
不可分割——通过同一个 fn 内部连续 await 实现。
      `.trim(),
    },

    noIntermediateState: {
      kind: "invariant",
      title: "index 与单条文件不会出现不一致中间态",
      summary: "前端读到 index 说有 3 条但只能找到 2 条单条文件——不会发生",
      content: "串行化保证 index.json 与单条 Issue/Task 文件之间不存在中间不一致态。",
      rationale: `
若允许中间态，前端列表页会看到"幻条目"——index 中有 id 但单条文件未写入，
进入详情页时 404。把两次写放进同一 enqueue 是消除该状态的最小代价方案。
      `.trim(),
    },
  },

  failure: {
    title: "失败处理",
    summary: "enqueue 的 fn 抛错时的三条规则",

    errorPropagation: {
      title: "错误向上抛",
      content: `
错误透传给调用方处理——SerialQueue 不吞错，调用方 \`await enqueue(...)\` 处直接捕获。
      `.trim(),
    },

    queueContinues: {
      title: "队列继续",
      content: `
一个任务失败后下一个写入正常执行——链尾被 \`.catch(() => {})\` 包装吞错，
不会因为一次失败而瘫痪整条 key 的后续写入。
      `.trim(),
    },

    fileSnapshotIntact: {
      title: "文件保持抛错前状态",
      content: `
如果抛错发生在读后、写前，文件未改。但若抛错发生在第一次写入与第二次写入之间
（indexSync.batchInOneEnqueue 内），可能出现部分写入——详见 limits。
      `.trim(),
    },
  },

  performance: {
    title: "性能权衡",
    summary: "数据正确性 > 速度；跨 key 并发不互相等待",
    content: `
串行化看似慢，实际：

- 同一 key 的并发写必须串行化（数据正确性 > 速度）
- 不同 key 的并发写不相互等待
- 看板写入频率通常不高（每分钟几十次量级）
    `.trim(),
  },

  otherUsers: {
    title: "其他使用 SerialQueue 的场景",
    summary: "每个上层调用点根据自身领域边界选 key",
    content: `
| 场景 | key |
|---|---|
| ThreadsTree 写 threads.json | 单 key（每个 ThreadsTree 实例一个 SerialQueue） |
| 用户 inbox 写入（user/data.json）| sessionId |
| super 分身目录写入 | stoneName |
    `.trim(),
  },

  limits: {
    title: "不解决的问题：原子写入",
    summary: "SerialQueue 解决并发竞态，不解决进程崩溃中途的半写文件",
    content: `
写文件用 \`Bun.write\` 直接写，不是 tmpfile + rename 模式。

如需进程崩溃保护，调用方可在 enqueue 内加 tmp+rename 包装；系统认为崩溃中途
的概率足够低，配合 git 历史可恢复。
    `.trim(),
  },
};
