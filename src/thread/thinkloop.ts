/**
 * 线程 ThinkLoop —— 每个线程独立的执行循环
 *
 * 核心循环：构建 Context → 调用 LLM → 解析输出 → 执行 actions → 记录 → 检查终止条件
 *
 * 与旧 ThinkLoop（kernel/src/flow/thinkloop.ts）的区别：
 * - 每个线程独立执行，不共享 Flow 状态
 * - 使用 create_sub_thread / return 替代 push / pop
 * - 使用 await / await_all 替代 wait
 * - 终止条件：return → done, await → waiting, error → failed
 * - 不需要暂停恢复机制（Scheduler 控制）
 *
 * 本模块只实现「单轮迭代」的纯函数 runThreadIteration。
 * 完整的 async loop 由阶段 4 的 Scheduler 驱动。
 *
 * @ref docs/superpowers/specs/2026-04-06-thread-tree-architecture-design.md#6
 */

import type { StoneData, TraitDefinition } from "../types/index.js";
import type {
  ThreadsTreeFile,
  ThreadsTreeNodeMeta,
  ThreadDataFile,
  ThreadAction,
  ThreadResult,
  ThreadInboxMessage,
  ThreadTodoItem,
  ThreadStatus,
} from "./types.js";
import { parseThreadOutput } from "./parser.js";
import type { ProgramSection, TalkSection } from "../toml/parser.js";
import { collectBeforeHooks, collectAfterHooks } from "./hooks.js";
import { computeThreadScopeChain } from "./context-builder.js";

/** 单轮迭代的输入 */
export interface ThreadIterationInput {
  /** 线程树（只读，本函数不修改） */
  tree: ThreadsTreeFile;
  /** 当前线程 ID */
  threadId: string;
  /** 当前线程数据（只读，本函数不修改） */
  threadData: ThreadDataFile;
  /** LLM 输出文本（由调用方负责调用 LLM） */
  llmOutput: string;
  /** Stone 数据 */
  stone: StoneData;
  /** 所有已加载的 traits */
  traits: TraitDefinition[];
  /** 已触发的 hooks（可选，跨轮次传递） */
  firedHooks?: Set<string>;
}

/** inbox 消息更新 */
export interface InboxUpdate {
  messageId: string;
  mark: {
    type: "ack" | "ignore" | "todo";
    tip: string;
    markedAt: number;
  };
}

/** 新创建的子节点信息 */
export interface NewChildNode {
  /** 子节点 ID（由本函数生成） */
  id: string;
  title: string;
  description?: string;
  traits?: string[];
  status: ThreadStatus;
  parentId: string;
  /** 创建者线程 ID */
  creatorThreadId: string;
  /** 从哪个线程派生（不填则从当前线程派生） */
  deriveFrom?: string;
}

/** 单轮迭代的输出（纯数据，不含副作用） */
export interface ThreadIterationResult {
  /** 新增的 actions（需要追加到 threadData.actions） */
  newActions: ThreadAction[];
  /** 线程状态变更（null = 不变，继续 running） */
  statusChange: ThreadStatus | null;
  /** return 结果（仅当 statusChange === "done" 时有值） */
  returnResult: ThreadResult | null;
  /** 等待的子线程 ID 列表（仅当 statusChange === "waiting" 时有值） */
  awaitingChildren: string[] | null;
  /** 新创建的子节点（需要写入 threads.json） */
  newChildNode: NewChildNode | null;
  /** 向已有子线程追加消息 */
  continueSubThread: { threadId: string; message: string } | null;
  /** before hook 注入文本（需要写入子线程的首条 inject action） */
  beforeHookInjection: string | null;
  /** after hook 注入文本（需要写入创建者线程的下一轮 inject action） */
  afterHookInjection: string | null;
  /** inbox 消息更新 */
  inboxUpdates: InboxUpdate[];
  /** 新增的待办项 */
  newTodos: ThreadTodoItem[];
  /** 计划更新（null = 不变） */
  planUpdate: string | null;
  /**
   * 解析出的 program 段（需要 Scheduler 异步执行 CodeExecutor）
   * 本函数不执行 program，只传递解析结果给调用方。
   */
  program: ProgramSection | null;
  /**
   * 解析出的 talk 段（需要 Scheduler 异步执行 collaboration.talk()）
   * 本函数不执行 talk，只传递解析结果给调用方。
   */
  talks: TalkSection | null;
}

/**
 * 执行单轮迭代（纯函数，不产生副作用）
 *
 * 调用方（Scheduler）负责：
 * 1. 调用 LLM 获取 llmOutput
 * 2. 调用本函数获取 result
 * 3. 根据 result 更新 threadData / tree / 持久化
 *
 * @param input - 迭代输入
 * @returns 迭代结果
 */
export function runThreadIteration(input: ThreadIterationInput): ThreadIterationResult {
  const { tree, threadId, threadData, llmOutput, stone, traits } = input;
  const firedHooks = input.firedHooks ?? new Set<string>();

  const result: ThreadIterationResult = {
    newActions: [],
    statusChange: null,
    returnResult: null,
    awaitingChildren: null,
    newChildNode: null,
    continueSubThread: null,
    beforeHookInjection: null,
    afterHookInjection: null,
    inboxUpdates: [],
    newTodos: [],
    planUpdate: null,
    program: null,
    talks: null,
  };

  /* 1. 解析 LLM 输出 */
  const parsed = parseThreadOutput(llmOutput);

  /* 2. 记录 thought */
  if (parsed.thought) {
    result.newActions.push({
      type: "thought",
      content: parsed.thought,
      timestamp: Date.now(),
    });
  }

  /* 3. 处理 set_plan */
  if (parsed.setPlan) {
    result.planUpdate = parsed.setPlan;
    result.newActions.push({
      type: "set_plan",
      content: parsed.setPlan,
      timestamp: Date.now(),
    });
  }

  /* 4. 处理 mark */
  if (parsed.mark) {
    result.inboxUpdates.push({
      messageId: parsed.mark.messageId,
      mark: {
        type: parsed.mark.type,
        tip: parsed.mark.tip,
        markedAt: Date.now(),
      },
    });
  }

  /* 4b. 处理 talk/talk_sync 内联 mark（发送消息时顺带 ack） */
  const talkMarkIds = parsed.talk?.mark?.message_ids ?? [];
  if (talkMarkIds.length > 0) {
    for (const messageId of talkMarkIds) {
      result.inboxUpdates.push({
        messageId,
        mark: {
          type: parsed.talk!.mark!.type ?? "ack",
          tip: parsed.talk!.mark!.tip ?? "已回复",
          markedAt: Date.now(),
        },
      });
    }
  }

  const talkSyncMarkIds = parsed.talkSync?.mark?.message_ids ?? [];
  if (talkSyncMarkIds.length > 0) {
    for (const messageId of talkSyncMarkIds) {
      result.inboxUpdates.push({
        messageId,
        mark: {
          type: parsed.talkSync!.mark!.type ?? "ack",
          tip: parsed.talkSync!.mark!.tip ?? "已回复",
          markedAt: Date.now(),
        },
      });
    }
  }

  /* 5. 处理 addTodo */
  if (parsed.addTodo) {
    result.newTodos.push({
      id: `todo_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      content: parsed.addTodo.content,
      sourceMessageId: parsed.addTodo.sourceMessageId,
      status: "pending",
      createdAt: Date.now(),
    });
  }

  /* 6. 处理 create_sub_thread */
  if (parsed.createSubThread) {
    const childId = `thread_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const cst = parsed.createSubThread;

    /* deriveFrom 决定子线程挂在哪个节点下：
     * - 不填：挂在当前线程下（普通 create_sub_thread）
     * - 填了：挂在目标线程下（create_sub_thread_on_node 语义） */
    const parentId = cst.deriveFrom ?? threadId;

    result.newChildNode = {
      id: childId,
      title: cst.title,
      description: cst.description,
      traits: cst.traits,
      status: "pending",
      parentId,
      creatorThreadId: threadId,
      deriveFrom: cst.deriveFrom,
    };

    const actionLabel = cst.deriveFrom
      ? `[create_sub_thread derive_from=${cst.deriveFrom}] ${cst.title} → ${childId}`
      : `[create_sub_thread] ${cst.title} → ${childId}`;
    result.newActions.push({
      type: "create_thread",
      content: actionLabel,
      timestamp: Date.now(),
    });

    /* 收集 before hooks（注入子线程首轮 Context） */
    const scopeChain = computeThreadScopeChain(tree, threadId);
    /* 子线程的 scope chain = 父 scope chain + 子线程自身 traits */
    const childScopeChain = [...scopeChain, ...(cst.traits ?? [])];
    const beforeInjection = collectBeforeHooks(traits, childScopeChain, firedHooks);
    if (beforeInjection) {
      result.beforeHookInjection = beforeInjection;
    }
  }

  /* 6b. 处理 continue_sub_thread */
  if (parsed.continueSubThread && parsed.continueSubThread.threadId) {
    const cst = parsed.continueSubThread;

    /* 安全检查：目标线程必须是当前线程的直接子线程 */
    const targetNode = tree.nodes[cst.threadId];
    if (targetNode && targetNode.creatorThreadId === threadId) {
      result.continueSubThread = {
        threadId: cst.threadId,
        message: cst.message,
      };

      result.newActions.push({
        type: "message_out",
        content: `[continue_sub_thread] → ${cst.threadId}: ${cst.message}`,
        timestamp: Date.now(),
      });

      /* 自动进入 waiting，等待子线程再次完成 */
      result.statusChange = "waiting";
      result.awaitingChildren = [cst.threadId];
    }
  }

  /* 7. 处理 return */
  if (parsed.threadReturn) {
    const ret = parsed.threadReturn;
    result.statusChange = "done";
    result.returnResult = {
      summary: ret.summary,
      artifacts: ret.artifacts,
      status: "done",
    };

    result.newActions.push({
      type: "thread_return",
      content: `[return] ${ret.summary}`,
      timestamp: Date.now(),
    });

    /* 收集 after hooks（注入创建者线程下一轮 Context） */
    const nodeMeta = tree.nodes[threadId];
    if (nodeMeta?.creatorThreadId) {
      const creatorScopeChain = computeThreadScopeChain(tree, nodeMeta.creatorThreadId);
      const afterInjection = collectAfterHooks(traits, creatorScopeChain, firedHooks);
      if (afterInjection) {
        result.afterHookInjection = afterInjection;
      }
    }

    return result; /* return 后立即退出，不再处理其他指令 */
  }

  /* 8. 处理 await / await_all */
  if (parsed.awaitThreads && parsed.awaitThreads.length > 0) {
    result.statusChange = "waiting";
    result.awaitingChildren = parsed.awaitThreads;
    return result; /* await 后立即退出 */
  }

  /* 9. 传递 program 和 talk 给调用方（Scheduler）
   *    本函数不执行它们（需要异步 IO），只标记解析结果。
   *    Scheduler 的 runOneIteration 负责调用 CodeExecutor / collaboration.talk()，
   *    并在执行后生成对应的 recordAction。
   *
   *    注意：[talk] 是纯异步发消息，不触发状态变更。
   *    LLM 应该用 [return] 明确结束线程，而不是靠 [talk] 自动结束。
   */
  if (parsed.program) result.program = parsed.program;
  if (parsed.talk) {
    result.talks = parsed.talk;
  }

  /* 10. 处理 talk_sync（同步 talk：发送消息后自动 wait） */
  if (parsed.talkSync && !result.statusChange) {
    result.talks = parsed.talkSync;
    result.statusChange = "waiting";
    result.newActions.push({
      type: "message_out",
      content: `[talk_sync] → ${parsed.talkSync.target}: ${parsed.talkSync.message}`,
      timestamp: Date.now(),
    });
  }

  return result;
}
