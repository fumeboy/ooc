/**
 * 线程 ThinkLoop 测试
 *
 * 使用 mock LLM 验证 ThinkLoop 的核心循环逻辑。
 * 不测试真实 LLM 调用，只测试指令解析 → 状态变更的正确性。
 *
 * @ref docs/superpowers/specs/2026-04-06-thread-tree-architecture-design.md#6
 */
import { describe, test, expect, beforeEach } from "bun:test";
import {
  runThreadIteration,
  type ThreadIterationInput,
  type ThreadIterationResult,
} from "../src/thread/thinkloop.js";
import type {
  ThreadsTreeFile,
  ThreadsTreeNodeMeta,
  ThreadDataFile,
  ThreadAction,
} from "../src/thread/types.js";

/** 辅助：创建节点元数据 */
function makeNode(id: string, overrides?: Partial<ThreadsTreeNodeMeta>): ThreadsTreeNodeMeta {
  return {
    id,
    title: overrides?.title ?? id,
    status: overrides?.status ?? "running",
    childrenIds: overrides?.childrenIds ?? [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

describe("runThreadIteration — create_sub_thread", () => {
  test("解析 create_sub_thread 后创建子节点并记录 action", () => {
    const tree: ThreadsTreeFile = {
      rootId: "r",
      nodes: {
        r: makeNode("r", { traits: ["kernel/computable"] }),
      },
    };
    const threadData: ThreadDataFile = { id: "r", actions: [] };

    const llmOutput = `
[thought]
content = "需要创建子线程搜索"

[create_sub_thread]
title = "搜索 AI Safety"
description = "搜索相关论文"
traits = ["academic_writing"]
`;

    const input: ThreadIterationInput = {
      tree,
      threadId: "r",
      threadData,
      llmOutput,
      stone: { name: "obj", thinkable: { whoAmI: "test" } } as any,
      traits: [],
    };

    const result = runThreadIteration(input);

    /* 验证子节点被创建 */
    expect(result.newChildNode).not.toBeNull();
    expect(result.newChildNode!.title).toBe("搜索 AI Safety");
    expect(result.newChildNode!.traits).toEqual(["academic_writing"]);
    expect(result.newChildNode!.status).toBe("pending");

    /* 验证 action 被记录 */
    const createAction = result.newActions.find(a => a.type === "create_thread");
    expect(createAction).toBeDefined();
    expect(createAction!.content).toContain("搜索 AI Safety");

    /* 线程状态不变（继续 running） */
    expect(result.statusChange).toBeNull();
  });
});

describe("runThreadIteration — return", () => {
  test("解析 return 后线程状态变为 done", () => {
    const tree: ThreadsTreeFile = {
      rootId: "r",
      nodes: {
        r: makeNode("r", { childrenIds: ["a"] }),
        a: makeNode("a", { parentId: "r", title: "子任务" }),
      },
    };
    const threadData: ThreadDataFile = { id: "a", actions: [] };

    const llmOutput = `
[return]
summary = "任务完成，找到 3 篇论文"

[return.artifacts]
count = 3
`;

    const input: ThreadIterationInput = {
      tree,
      threadId: "a",
      threadData,
      llmOutput,
      stone: { name: "obj", thinkable: { whoAmI: "test" } } as any,
      traits: [],
    };

    const result = runThreadIteration(input);

    expect(result.statusChange).toBe("done");
    expect(result.returnResult).not.toBeNull();
    expect(result.returnResult!.summary).toBe("任务完成，找到 3 篇论文");
    expect(result.returnResult!.artifacts).toEqual({ count: 3 });

    /* 验证 thread_return action 被记录 */
    const returnAction = result.newActions.find(a => a.type === "thread_return");
    expect(returnAction).toBeDefined();
  });
});

describe("runThreadIteration — await", () => {
  test("解析 await 后线程状态变为 waiting", () => {
    const tree: ThreadsTreeFile = {
      rootId: "r",
      nodes: {
        r: makeNode("r", { childrenIds: ["a"] }),
        a: makeNode("a", { parentId: "r", status: "running" }),
      },
    };
    const threadData: ThreadDataFile = { id: "r", actions: [] };

    const llmOutput = `
[await]
thread_id = "a"
`;

    const input: ThreadIterationInput = {
      tree,
      threadId: "r",
      threadData,
      llmOutput,
      stone: { name: "obj", thinkable: { whoAmI: "test" } } as any,
      traits: [],
    };

    const result = runThreadIteration(input);

    expect(result.statusChange).toBe("waiting");
    expect(result.awaitingChildren).toEqual(["a"]);
  });

  test("解析 await_all 后设置多个等待目标", () => {
    const tree: ThreadsTreeFile = {
      rootId: "r",
      nodes: {
        r: makeNode("r", { childrenIds: ["a", "b"] }),
        a: makeNode("a", { parentId: "r" }),
        b: makeNode("b", { parentId: "r" }),
      },
    };
    const threadData: ThreadDataFile = { id: "r", actions: [] };

    const llmOutput = `
[await_all]
thread_ids = ["a", "b"]
`;

    const input: ThreadIterationInput = {
      tree,
      threadId: "r",
      threadData,
      llmOutput,
      stone: { name: "obj", thinkable: { whoAmI: "test" } } as any,
      traits: [],
    };

    const result = runThreadIteration(input);

    expect(result.statusChange).toBe("waiting");
    expect(result.awaitingChildren).toEqual(["a", "b"]);
  });
});

describe("runThreadIteration — mark + addTodo", () => {
  test("mark 更新 inbox 消息状态", () => {
    const tree: ThreadsTreeFile = {
      rootId: "r",
      nodes: { r: makeNode("r") },
    };
    const threadData: ThreadDataFile = {
      id: "r",
      actions: [],
      inbox: [
        { id: "msg1", from: "A", content: "你好", timestamp: 1000, source: "talk", status: "unread" },
      ],
    };

    const llmOutput = `
[mark]
message_id = "msg1"
type = "ack"
tip = "已收到"
`;

    const input: ThreadIterationInput = {
      tree,
      threadId: "r",
      threadData,
      llmOutput,
      stone: { name: "obj", thinkable: { whoAmI: "test" } } as any,
      traits: [],
    };

    const result = runThreadIteration(input);

    /* 验证 inbox 消息被标记 */
    expect(result.inboxUpdates).toHaveLength(1);
    expect(result.inboxUpdates[0]!.messageId).toBe("msg1");
    expect(result.inboxUpdates[0]!.mark.type).toBe("ack");
  });

  test("addTodo 创建待办项", () => {
    const tree: ThreadsTreeFile = {
      rootId: "r",
      nodes: { r: makeNode("r") },
    };
    const threadData: ThreadDataFile = { id: "r", actions: [] };

    const llmOutput = `
[addTodo]
content = "回复 A 的消息"
source_message_id = "msg1"
`;

    const input: ThreadIterationInput = {
      tree,
      threadId: "r",
      threadData,
      llmOutput,
      stone: { name: "obj", thinkable: { whoAmI: "test" } } as any,
      traits: [],
    };

    const result = runThreadIteration(input);

    expect(result.newTodos).toHaveLength(1);
    expect(result.newTodos[0]!.content).toBe("回复 A 的消息");
    expect(result.newTodos[0]!.sourceMessageId).toBe("msg1");
  });
});

describe("runThreadIteration — talk mark", () => {
  test("talk 段携带 mark_message_id 时自动产生 inboxUpdates", () => {
    const tree: ThreadsTreeFile = {
      rootId: "r",
      nodes: { r: makeNode("r") },
    };
    const threadData: ThreadDataFile = {
      id: "r",
      actions: [],
      inbox: [
        { id: "msg_123", from: "user", content: "hi", timestamp: 1000, source: "talk", status: "unread" },
      ],
    };

    const llmOutput = `
[talk]
target = "user"
message = "收到"
mark_message_id = "msg_123"
mark_type = "ack"
mark_tip = "已回复"
`;

    const input: ThreadIterationInput = {
      tree,
      threadId: "r",
      threadData,
      llmOutput,
      stone: { name: "obj", thinkable: { whoAmI: "test" } } as any,
      traits: [],
    };

    const result = runThreadIteration(input);
    expect(result.talks).not.toBeNull();
    expect(result.inboxUpdates.some(u => u.messageId === "msg_123")).toBe(true);
  });

  test("talk 段携带 mark_message_ids 时自动产生多个 inboxUpdates", () => {
    const tree: ThreadsTreeFile = {
      rootId: "r",
      nodes: { r: makeNode("r") },
    };
    const threadData: ThreadDataFile = {
      id: "r",
      actions: [],
      inbox: [
        { id: "msg_a", from: "user", content: "a", timestamp: 1000, source: "talk", status: "unread" },
        { id: "msg_b", from: "user", content: "b", timestamp: 1001, source: "talk", status: "unread" },
      ],
    };

    const llmOutput = `
[talk]
target = "user"
message = "收到"
mark_message_ids = ["msg_a", "msg_b"]
`;

    const input: ThreadIterationInput = {
      tree,
      threadId: "r",
      threadData,
      llmOutput,
      stone: { name: "obj", thinkable: { whoAmI: "test" } } as any,
      traits: [],
    };

    const result = runThreadIteration(input);
    const ids = result.inboxUpdates.map(u => u.messageId);
    expect(ids).toContain("msg_a");
    expect(ids).toContain("msg_b");
  });
});

describe("runThreadIteration — set_plan", () => {
  test("set_plan 更新计划文本", () => {
    const tree: ThreadsTreeFile = {
      rootId: "r",
      nodes: { r: makeNode("r") },
    };
    const threadData: ThreadDataFile = { id: "r", actions: [] };

    const llmOutput = `
[set_plan]
text = "1. 搜索 2. 分析 3. 总结"
`;

    const input: ThreadIterationInput = {
      tree,
      threadId: "r",
      threadData,
      llmOutput,
      stone: { name: "obj", thinkable: { whoAmI: "test" } } as any,
      traits: [],
    };

    const result = runThreadIteration(input);

    expect(result.planUpdate).toBe("1. 搜索 2. 分析 3. 总结");
  });
});

describe("runThreadIteration — thought only", () => {
  test("纯思考输出：记录 thought action，状态不变", () => {
    const tree: ThreadsTreeFile = {
      rootId: "r",
      nodes: { r: makeNode("r") },
    };
    const threadData: ThreadDataFile = { id: "r", actions: [] };

    const llmOutput = `
[thought]
content = "让我想想下一步该做什么..."
`;

    const input: ThreadIterationInput = {
      tree,
      threadId: "r",
      threadData,
      llmOutput,
      stone: { name: "obj", thinkable: { whoAmI: "test" } } as any,
      traits: [],
    };

    const result = runThreadIteration(input);

    expect(result.statusChange).toBeNull();
    const thoughtAction = result.newActions.find(a => a.type === "thought");
    expect(thoughtAction).toBeDefined();
    expect(thoughtAction!.content).toContain("让我想想");
  });
});

describe("runThreadIteration — before hooks", () => {
  test("create_sub_thread 时收集 before hooks 注入子线程", () => {
    const tree: ThreadsTreeFile = {
      rootId: "r",
      nodes: {
        r: makeNode("r", { traits: ["kernel/verifiable"] }),
      },
    };
    const threadData: ThreadDataFile = { id: "r", actions: [] };

    const llmOutput = `
[create_sub_thread]
title = "验证结果"
`;

    const traits = [{
      name: "kernel/verifiable",
      type: "how_to_think" as const,
      description: "",
      namespace: "kernel",
      readme: "",
      when: "always" as const,
      deps: [],
      methods: [],
      hooks: {
        before: { inject: "开始前，先明确验证标准。", once: true },
      },
    }];

    const input: ThreadIterationInput = {
      tree,
      threadId: "r",
      threadData,
      llmOutput,
      stone: { name: "obj", thinkable: { whoAmI: "test" } } as any,
      traits,
    };

    const result = runThreadIteration(input);

    expect(result.newChildNode).not.toBeNull();
    expect(result.beforeHookInjection).not.toBeNull();
    expect(result.beforeHookInjection).toContain("验证标准");
  });
});
