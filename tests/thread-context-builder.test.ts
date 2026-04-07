/**
 * 线程 Context 构建器测试
 *
 * @ref docs/superpowers/specs/2026-04-06-thread-tree-architecture-design.md#5
 */
import { describe, test, expect } from "bun:test";
import {
  buildThreadContext,
  renderThreadProcess,
  renderChildrenSummary,
  renderAncestorSummary,
  renderSiblingSummary,
  computeThreadScopeChain,
  type ThreadContextInput,
} from "../src/thread/context-builder.js";
import type {
  ThreadsTreeFile,
  ThreadsTreeNodeMeta,
  ThreadDataFile,
  ThreadAction,
  ThreadInboxMessage,
  ThreadTodoItem,
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

/** 辅助：创建线程数据 */
function makeThreadData(id: string, actions?: ThreadAction[]): ThreadDataFile {
  return {
    id,
    actions: actions ?? [],
  };
}

describe("computeThreadScopeChain", () => {
  test("Root 节点的 scope chain = Root 自身的 traits", () => {
    const tree: ThreadsTreeFile = {
      rootId: "r",
      nodes: {
        r: makeNode("r", { traits: ["kernel/computable", "kernel/talkable"] }),
      },
    };
    const chain = computeThreadScopeChain(tree, "r");
    expect(chain).toEqual(["kernel/computable", "kernel/talkable"]);
  });

  test("三层嵌套：scope chain 沿祖先链合并", () => {
    const tree: ThreadsTreeFile = {
      rootId: "r",
      nodes: {
        r: makeNode("r", {
          traits: ["kernel/computable", "kernel/talkable"],
          childrenIds: ["a"],
        }),
        a: makeNode("a", {
          parentId: "r",
          traits: ["academic_writing"],
          childrenIds: ["b"],
        }),
        b: makeNode("b", {
          parentId: "a",
          traits: ["domain/ai_safety"],
          activatedTraits: ["kernel/web_search"],
        }),
      },
    };
    const chain = computeThreadScopeChain(tree, "b");
    expect(chain).toContain("kernel/computable");
    expect(chain).toContain("kernel/talkable");
    expect(chain).toContain("academic_writing");
    expect(chain).toContain("domain/ai_safety");
    expect(chain).toContain("kernel/web_search");
  });

  test("去重：相同 trait 不重复", () => {
    const tree: ThreadsTreeFile = {
      rootId: "r",
      nodes: {
        r: makeNode("r", { traits: ["kernel/computable"], childrenIds: ["a"] }),
        a: makeNode("a", { parentId: "r", traits: ["kernel/computable"] }),
      },
    };
    const chain = computeThreadScopeChain(tree, "a");
    const computableCount = chain.filter(t => t === "kernel/computable").length;
    expect(computableCount).toBe(1);
  });
});

describe("renderChildrenSummary", () => {
  test("渲染子节点摘要", () => {
    const tree: ThreadsTreeFile = {
      rootId: "r",
      nodes: {
        r: makeNode("r", { childrenIds: ["a", "b"] }),
        a: makeNode("a", { parentId: "r", status: "done", title: "搜索 X", summary: "找到 3 篇论文" }),
        b: makeNode("b", { parentId: "r", status: "running", title: "搜索 Y" }),
      },
    };
    const summary = renderChildrenSummary(tree, "r");
    expect(summary).toContain("搜索 X");
    expect(summary).toContain("done");
    expect(summary).toContain("找到 3 篇论文");
    expect(summary).toContain("搜索 Y");
    expect(summary).toContain("running");
  });

  test("无子节点时返回空字符串", () => {
    const tree: ThreadsTreeFile = {
      rootId: "r",
      nodes: { r: makeNode("r") },
    };
    const summary = renderChildrenSummary(tree, "r");
    expect(summary).toBe("");
  });
});

describe("renderAncestorSummary", () => {
  test("渲染祖先节点摘要（Root → 父节点）", () => {
    const tree: ThreadsTreeFile = {
      rootId: "r",
      nodes: {
        r: makeNode("r", { title: "Root 任务", status: "running", childrenIds: ["a"] }),
        a: makeNode("a", { parentId: "r", title: "写论文", status: "running", summary: "进行中", childrenIds: ["b"] }),
        b: makeNode("b", { parentId: "a", title: "第二章", status: "running" }),
      },
    };
    const summary = renderAncestorSummary(tree, "b");
    expect(summary).toContain("Root 任务");
    expect(summary).toContain("写论文");
    expect(summary).toContain("进行中");
    expect(summary).not.toContain("第二章"); /* 不含自身 */
  });

  test("Root 节点无祖先，返回空字符串", () => {
    const tree: ThreadsTreeFile = {
      rootId: "r",
      nodes: { r: makeNode("r") },
    };
    const summary = renderAncestorSummary(tree, "r");
    expect(summary).toBe("");
  });
});

describe("renderSiblingSummary", () => {
  test("渲染兄弟节点摘要", () => {
    const tree: ThreadsTreeFile = {
      rootId: "r",
      nodes: {
        r: makeNode("r", { childrenIds: ["a", "b", "c"] }),
        a: makeNode("a", { parentId: "r", title: "搜索 X", status: "done", summary: "找到 3 篇" }),
        b: makeNode("b", { parentId: "r", title: "搜索 Y", status: "running" }),
        c: makeNode("c", { parentId: "r", title: "搜索 Z", status: "pending" }),
      },
    };
    const summary = renderSiblingSummary(tree, "b");
    expect(summary).toContain("搜索 X");
    expect(summary).toContain("done");
    expect(summary).toContain("找到 3 篇");
    expect(summary).toContain("搜索 Z");
    expect(summary).toContain("pending");
    expect(summary).not.toContain("搜索 Y"); /* 不含自身 */
  });

  test("无兄弟节点时返回空字符串", () => {
    const tree: ThreadsTreeFile = {
      rootId: "r",
      nodes: {
        r: makeNode("r", { childrenIds: ["a"] }),
        a: makeNode("a", { parentId: "r" }),
      },
    };
    const summary = renderSiblingSummary(tree, "a");
    expect(summary).toBe("");
  });

  test("Root 节点无兄弟，返回空字符串", () => {
    const tree: ThreadsTreeFile = {
      rootId: "r",
      nodes: { r: makeNode("r") },
    };
    const summary = renderSiblingSummary(tree, "r");
    expect(summary).toBe("");
  });
});

describe("renderThreadProcess", () => {
  test("渲染 actions 时间线", () => {
    const actions: ThreadAction[] = [
      { type: "thought", content: "开始思考", timestamp: 1000 },
      { type: "program", content: "search('AI')", result: "found 3", success: true, timestamp: 2000 },
      { type: "inject", content: "=== 父线程上下文 ===", timestamp: 500 },
    ];
    const rendered = renderThreadProcess(actions);
    expect(rendered).toContain("thought");
    expect(rendered).toContain("开始思考");
    expect(rendered).toContain("program");
    expect(rendered).toContain("search");
    expect(rendered).toContain("inject");
  });

  test("空 actions 返回提示文本", () => {
    const rendered = renderThreadProcess([]);
    expect(rendered).toContain("(无历史)");
  });
});

describe("buildThreadContext", () => {
  test("create_sub_thread 方式：初始 process 包含父线程快照", () => {
    const tree: ThreadsTreeFile = {
      rootId: "r",
      nodes: {
        r: makeNode("r", { title: "搜索论文", traits: ["kernel/computable"], childrenIds: ["a"] }),
        a: makeNode("a", {
          parentId: "r",
          title: "搜索子任务",
          description: "搜索 AI Safety 相关论文",
        }),
      },
    };
    const threadData: ThreadDataFile = {
      id: "a",
      actions: [
        { type: "inject", content: "=== 父线程上下文 ===\n之前讨论了...", timestamp: 1000 },
        { type: "thought", content: "开始搜索", timestamp: 2000 },
      ],
      plan: "1. 搜索 2. 整理",
    };
    const input: ThreadContextInput = {
      tree,
      threadId: "a",
      threadData,
      stone: { name: "researcher", thinkable: { whoAmI: "我是研究员" } } as any,
      directory: [],
      traits: [],
    };
    const ctx = buildThreadContext(input);
    expect(ctx.name).toBe("researcher");
    expect(ctx.whoAmI).toContain("研究员");
    expect(ctx.parentExpectation).toContain("搜索论文");
    expect(ctx.parentExpectation).toContain("AI Safety");
    expect(ctx.plan).toBe("1. 搜索 2. 整理");
    expect(ctx.process).toContain("父线程上下文");
    expect(ctx.process).toContain("开始搜索");
  });

  test("talk 方式：初始 process 为空", () => {
    const tree: ThreadsTreeFile = {
      rootId: "r",
      nodes: {
        r: makeNode("r", { childrenIds: ["h"] }),
        h: makeNode("h", {
          parentId: "r",
          title: "处理 A 的请求",
          creatorObjectName: "A",
        }),
      },
    };
    const threadData: ThreadDataFile = {
      id: "h",
      actions: [],
      inbox: [
        { id: "msg1", from: "A", content: "请搜索论文", timestamp: 1000, source: "talk", status: "unread" },
      ],
    };
    const input: ThreadContextInput = {
      tree,
      threadId: "h",
      threadData,
      stone: { name: "B", thinkable: { whoAmI: "我是 B" } } as any,
      directory: [],
      traits: [],
    };
    const ctx = buildThreadContext(input);
    expect(ctx.inbox).toHaveLength(1);
    expect(ctx.inbox[0]!.content).toContain("搜索论文");
  });

  test("规划视角：children + inbox + todos", () => {
    const tree: ThreadsTreeFile = {
      rootId: "r",
      nodes: {
        r: makeNode("r", { childrenIds: ["a", "b"] }),
        a: makeNode("a", { parentId: "r", status: "done", title: "子任务 A", summary: "完成" }),
        b: makeNode("b", { parentId: "r", status: "running", title: "子任务 B" }),
      },
    };
    const threadData: ThreadDataFile = {
      id: "r",
      actions: [{ type: "thought", content: "规划中", timestamp: 1000 }],
      inbox: [
        { id: "msg1", from: "X", content: "通知", timestamp: 2000, source: "system", status: "unread" },
      ],
      todos: [
        { id: "todo1", content: "回复 X", status: "pending", createdAt: 3000 },
      ],
    };
    const input: ThreadContextInput = {
      tree,
      threadId: "r",
      threadData,
      stone: { name: "obj", thinkable: { whoAmI: "我是 obj" } } as any,
      directory: [],
      traits: [],
    };
    const ctx = buildThreadContext(input);
    expect(ctx.childrenSummary).toContain("子任务 A");
    expect(ctx.childrenSummary).toContain("done");
    expect(ctx.childrenSummary).toContain("完成");
    expect(ctx.childrenSummary).toContain("子任务 B");
    expect(ctx.inbox).toHaveLength(1);
    expect(ctx.todos).toHaveLength(1);
  });

  test("Root 节点无 parentExpectation", () => {
    const tree: ThreadsTreeFile = {
      rootId: "r",
      nodes: { r: makeNode("r", { title: "Root" }) },
    };
    const threadData: ThreadDataFile = { id: "r", actions: [] };
    const input: ThreadContextInput = {
      tree,
      threadId: "r",
      threadData,
      stone: { name: "obj", thinkable: { whoAmI: "我是 obj" } } as any,
      directory: [],
      traits: [],
    };
    const ctx = buildThreadContext(input);
    expect(ctx.parentExpectation).toBe("");
  });

  test("create_sub_thread_on_node 方式：Context 包含目标节点完整历史（Phase 5 完善）", () => {
    const tree: ThreadsTreeFile = {
      rootId: "r",
      nodes: {
        r: makeNode("r", { childrenIds: ["c"] }),
        c: makeNode("c", {
          parentId: "r",
          status: "done",
          title: "已完成的任务",
          summary: "产出了文档",
          childrenIds: ["sub"],
        }),
        sub: makeNode("sub", {
          parentId: "c",
          title: "回忆子线程",
          description: "你产出的文档路径在哪？",
        }),
      },
    };
    const targetNodeData: ThreadDataFile = {
      id: "c",
      actions: [
        { type: "thought", content: "我在写文档", timestamp: 1000 },
        { type: "program", content: "writeFile('doc.md')", result: "ok", success: true, timestamp: 2000 },
      ],
    };
    const threadData: ThreadDataFile = { id: "sub", actions: [] };
    const input: ThreadContextInput = {
      tree,
      threadId: "sub",
      threadData,
      stone: { name: "obj", thinkable: { whoAmI: "我是 obj" } } as any,
      directory: [],
      traits: [],
      targetNodeData,
    };
    const ctx = buildThreadContext(input);
    /* Phase 5 完善：验证 targetNodeData 的 actions 被渲染到 Context 中 */
    expect(ctx.parentExpectation).toContain("已完成的任务");
    expect(ctx.parentExpectation).toContain("你产出的文档路径在哪？");
  });
});
