/**
 * 协作 API 测试
 *
 * 测试 talk、create_sub_thread_on_node、talkToSelf、replyToFlow 的完整生命周期。
 * 使用 mock 的 ThreadsTree（匹配真实 API）和 MockScheduler。
 *
 * @ref docs/superpowers/specs/2026-04-06-thread-tree-architecture-design.md#4.2
 * @ref docs/superpowers/specs/2026-04-06-thread-tree-architecture-design.md#9
 */
import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  createCollaborationAPI,
  type CollaborationContext,
  type ObjectResolver,
} from "../src/thread/collaboration.js";
import { ThreadsTree } from "../src/thread/tree.js";
import type {
  ThreadsTreeNodeMeta,
  ThreadDataFile,
  ThreadInboxMessage,
  ThreadStatus,
} from "../src/thread/types.js";

/* ========== Mock 基础设施 ========== */

/**
 * 简易内存树 mock — 模拟 ThreadsTree 的真实 API
 *
 * 【重要】必须与 kernel/src/thread/tree.ts 的 ThreadsTree 公开 API 一致：
 * - rootId (getter)，不是 getRootId()
 * - createSubThread(parentId, title, options?) → Promise<string | null>
 * - setNodeStatus(nodeId, status) → Promise<void>
 * - awaitThreads(nodeId, childIds) → Promise<void>
 * - checkAndWake(nodeId) → Promise<boolean>
 * - writeInbox(nodeId, msg) → void
 * - readThreadData(nodeId) → ThreadDataFile | null
 * - writeThreadData(nodeId, data) → void
 * - getNode / getChildren / findWaitingParents 等只读方法
 *
 * 不存在的方法（不可使用）：
 * ✗ createNode / updateNode / flush / getRootId
 */
class MockTree {
  nodes: Record<string, ThreadsTreeNodeMeta> = {};
  threadData: Record<string, ThreadDataFile> = {};
  private _rootId = "root_001";
  private _nextId = 0;

  constructor() {
    const now = Date.now();
    this.nodes["root_001"] = {
      id: "root_001",
      title: "Root",
      status: "running",
      childrenIds: [],
      createdAt: now,
      updatedAt: now,
    };
    this.threadData["root_001"] = { id: "root_001", actions: [] };
  }

  get rootId() { return this._rootId; }

  getNode(id: string) { return this.nodes[id] ? { ...this.nodes[id] } : null; }

  getChildren(id: string) {
    const node = this.nodes[id];
    if (!node) return [];
    return node.childrenIds.map((cid) => this.nodes[cid]!).filter(Boolean).map(n => ({ ...n }));
  }

  async createSubThread(
    parentId: string,
    title: string,
    options?: {
      traits?: string[];
      description?: string;
      creatorThreadId?: string;
      creatorObjectName?: string;
      linkedWaitingNodeId?: string;
      linkedWaitingObjectName?: string;
      creationMode?: "sub_thread" | "sub_thread_on_node" | "talk";
    },
  ): Promise<string | null> {
    const parent = this.nodes[parentId];
    if (!parent) return null;
    const id = `th_mock_${this._nextId++}`;
    const now = Date.now();
    parent.childrenIds.push(id);
    this.nodes[id] = {
      id,
      title,
      description: options?.description,
      status: "pending",
      parentId,
      childrenIds: [],
      creatorThreadId: options?.creatorThreadId ?? parentId,
      creatorObjectName: options?.creatorObjectName,
      linkedWaitingNodeId: options?.linkedWaitingNodeId,
      linkedWaitingObjectName: options?.linkedWaitingObjectName,
      creationMode: options?.creationMode,
      createdAt: now,
      updatedAt: now,
    };
    this.threadData[id] = { id, actions: [] };
    return id;
  }

  async setNodeStatus(nodeId: string, status: ThreadStatus): Promise<void> {
    const node = this.nodes[nodeId];
    if (node) {
      node.status = status;
      node.updatedAt = Date.now();
    }
  }

  async updateNodeMeta(nodeId: string, fields: Partial<Pick<ThreadsTreeNodeMeta,
    "summary" | "description" | "awaitingChildren" | "linkedWaitingNodeId" | "linkedWaitingObjectName"
  >>): Promise<void> {
    const node = this.nodes[nodeId];
    if (node) {
      Object.assign(node, fields);
      node.updatedAt = Date.now();
    }
  }

  async returnThread(nodeId: string, summary: string, artifacts?: Record<string, unknown>): Promise<void> {
    const node = this.nodes[nodeId];
    if (!node) return;
    node.status = "done";
    node.summary = summary;
    node.updatedAt = Date.now();
    if (node.creatorThreadId && this.nodes[node.creatorThreadId]) {
      const creatorData = this.readThreadData(node.creatorThreadId);
      if (creatorData) {
        if (artifacts) creatorData.locals = { ...(creatorData.locals ?? {}), ...artifacts };
        if (!creatorData.inbox) creatorData.inbox = [];
        creatorData.inbox.push({
          id: `msg_${Date.now().toString(36)}`,
          from: node.title,
          content: `子线程「${node.title}」已完成: ${summary}`,
          timestamp: Date.now(),
          source: "system",
          status: "unread",
        });
        this.writeThreadData(node.creatorThreadId, creatorData);
      }
    }
  }

  async awaitThreads(nodeId: string, childIds: string[]): Promise<void> {
    const node = this.nodes[nodeId];
    if (node) {
      node.awaitingChildren = childIds;
      node.status = "waiting";
      node.updatedAt = Date.now();
    }
  }

  async checkAndWake(nodeId: string): Promise<boolean> {
    const node = this.nodes[nodeId];
    if (!node || node.status !== "waiting" || !node.awaitingChildren) return false;
    const allDone = node.awaitingChildren.every(cid => {
      const c = this.nodes[cid];
      return c && (c.status === "done" || c.status === "failed");
    });
    if (!allDone) return false;
    node.awaitingChildren = undefined;
    node.status = "running";
    node.updatedAt = Date.now();
    return true;
  }

  findWaitingParents(childId: string): string[] {
    return Object.values(this.nodes)
      .filter(n => n.status === "waiting" && n.awaitingChildren?.includes(childId))
      .map(n => n.id);
  }

  writeInbox(nodeId: string, msg: { from: string; content: string; source: ThreadInboxMessage["source"]; issueId?: string }): void {
    const data = this.readThreadData(nodeId);
    if (!data) return;
    if (!data.inbox) data.inbox = [];
    data.inbox.push({
      id: `msg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      from: msg.from,
      content: msg.content,
      timestamp: Date.now(),
      source: msg.source,
      issueId: msg.issueId,
      status: "unread",
    });
    this.writeThreadData(nodeId, data);
  }

  readThreadData(nodeId: string): ThreadDataFile | null {
    if (!this.threadData[nodeId]) return null;
    return this.threadData[nodeId]!;
  }

  writeThreadData(nodeId: string, data: ThreadDataFile): void {
    this.threadData[nodeId] = data;
  }
}

/** 简易 Scheduler mock */
class MockScheduler {
  started: { objectName: string; nodeId: string }[] = [];
  woken: { objectName: string; nodeId: string }[] = [];

  startThread(objectName: string, nodeId: string) {
    this.started.push({ objectName, nodeId });
  }
  wakeThread(objectName: string, nodeId: string) {
    this.woken.push({ objectName, nodeId });
  }
}

/* ========== 测试 ========== */

describe("talk() 完整生命周期", () => {
  let treeA: MockTree;
  let treeB: MockTree;
  let scheduler: MockScheduler;
  let api: ReturnType<typeof createCollaborationAPI>;

  beforeEach(() => {
    treeA = new MockTree();
    treeB = new MockTree();
    scheduler = new MockScheduler();

    const resolver: ObjectResolver = {
      getTree: (name) => (name === "A" ? treeA : treeB) as any,
      objectExists: (name) => name === "A" || name === "B",
    };

    const ctx: CollaborationContext = {
      currentObjectName: "A",
      currentThreadId: "root_001",
      resolver,
      scheduler: scheduler as any,
      sessionDir: "/tmp/test-session",
    };

    api = createCollaborationAPI(ctx);
  });

  test("talk 创建 W 节点（waiting）在 A 侧 + H 节点（running）在 B 侧", async () => {
    const result = await api.talk("B", "请帮我搜索 AI safety");

    // A 侧：当前节点下创建了 W 子节点
    const aChildren = treeA.getChildren("root_001");
    expect(aChildren).toHaveLength(1);
    const W = aChildren[0]!;
    expect(W.status).toBe("waiting");
    expect(W.title).toContain("等待 B 回复");
    expect(W.creatorThreadId).toBe("root_001");

    // B 侧：Root 下创建了 H 子节点
    const bChildren = treeB.getChildren("root_001");
    expect(bChildren).toHaveLength(1);
    const H = bChildren[0]!;
    expect(H.status).toBe("running");
    expect(H.title).toContain("处理 A 的请求");
    expect(H.creatorThreadId).toBe("root_001");
    expect(H.creatorObjectName).toBe("A");

    // H 的 inbox 收到消息（通过 tree.writeInbox）
    const hData = treeB.readThreadData(H.id);
    expect(hData?.inbox).toHaveLength(1);
    expect(hData!.inbox![0]!.content).toBe("请帮我搜索 AI safety");
    expect(hData!.inbox![0]!.source).toBe("talk");

    // Scheduler 启动了 H 的线程
    expect(scheduler.started).toHaveLength(1);
    expect(scheduler.started[0]!.objectName).toBe("B");
    expect(scheduler.started[0]!.nodeId).toBe(H.id);

    // A 的当前线程进入 waiting
    const aRoot = treeA.getNode("root_001")!;
    expect(aRoot.status).toBe("waiting");
    expect(aRoot.awaitingChildren).toContain(W.id);
  });

  test("talk 目标不存在时返回错误", async () => {
    const result = await api.talk("C_not_exist", "hello");
    expect(result).toContain("错误");
  });

  test("talk 不能向自己发消息", async () => {
    const result = await api.talk("A", "hello self");
    expect(result).toContain("错误");
  });
});

describe("create_sub_thread_on_node()", () => {
  let tree: MockTree;
  let scheduler: MockScheduler;
  let api: ReturnType<typeof createCollaborationAPI>;

  beforeEach(() => {
    tree = new MockTree();
    scheduler = new MockScheduler();

    // 创建一个已完成的子节点 C（通过 createSubThread）
    // 注意：createSubThread 是 async，需要 await
  });

  test("在目标节点下创建子线程", async () => {
    // 先创建已完成的子节点 C
    const childCId = await tree.createSubThread("root_001", "已完成的任务 C", {
      creatorThreadId: "root_001",
    });
    expect(childCId).not.toBeNull();
    await tree.returnThread(childCId!, "C 完成了数据收集");

    // 给 C 写入一些 actions 历史
    const cData = tree.readThreadData(childCId!);
    cData!.actions = [
      { type: "thought", content: "开始收集数据", timestamp: 1000 },
      { type: "action", content: "调用 API", timestamp: 2000, result: "成功", success: true },
    ];
    tree.writeThreadData(childCId!, cData!);

    const resolver: ObjectResolver = {
      getTree: () => tree as any,
      objectExists: () => true,
    };

    const ctx: CollaborationContext = {
      currentObjectName: "A",
      currentThreadId: "root_001",
      resolver,
      scheduler: scheduler as any,
      sessionDir: "/tmp/test-session",
    };

    api = createCollaborationAPI(ctx);

    const result = await api.createSubThreadOnNode(childCId!, "你收集的数据路径在哪？");

    // child_c 下创建了新子节点
    const cChildren = tree.getChildren(childCId!);
    expect(cChildren).toHaveLength(1);
    const sub = cChildren[0]!;
    expect(sub.status).toBe("running");
    expect(sub.creatorThreadId).toBe("root_001");
    expect(sub.creatorObjectName).toBe("A");

    // I2: 新子线程的 thread.json 包含目标节点的完整 actions（inject action）
    const subData = tree.readThreadData(sub.id);
    expect(subData).not.toBeNull();
    const injectAction = subData!.actions.find((a: any) => a.type === "inject");
    expect(injectAction).toBeDefined();
    expect(injectAction!.content).toContain("开始收集数据");
    expect(injectAction!.content).toContain("调用 API");

    // 新子线程的 inbox 收到消息
    expect(subData!.inbox).toHaveLength(1);
    expect(subData!.inbox![0]!.content).toBe("你收集的数据路径在哪？");

    // Scheduler 启动了新线程
    expect(scheduler.started).toHaveLength(1);
  });

  test("目标节点不存在时返回错误", async () => {
    const resolver: ObjectResolver = {
      getTree: () => tree as any,
      objectExists: () => true,
    };
    const ctx: CollaborationContext = {
      currentObjectName: "A",
      currentThreadId: "root_001",
      resolver,
      scheduler: scheduler as any,
      sessionDir: "/tmp/test-session",
    };
    api = createCollaborationAPI(ctx);
    const result = await api.createSubThreadOnNode("nonexistent", "hello");
    expect(result).toContain("错误");
  });
});

describe("talkToSelf()", () => {
  let tree: MockTree;
  let scheduler: MockScheduler;
  let api: ReturnType<typeof createCollaborationAPI>;
  let deliverToSelfMetaCalled = false;

  beforeEach(() => {
    tree = new MockTree();
    scheduler = new MockScheduler();
    deliverToSelfMetaCalled = false;

    const resolver: ObjectResolver = {
      getTree: () => tree as any,
      objectExists: () => true,
    };

    const ctx: CollaborationContext = {
      currentObjectName: "A",
      currentThreadId: "root_001",
      resolver,
      scheduler: scheduler as any,
      sessionDir: "/tmp/test-session",
      deliverToSelfMeta: (_name: string, _msg: string) => {
        deliverToSelfMetaCalled = true;
        return "[已发送到 ReflectFlow]";
      },
    };

    api = createCollaborationAPI(ctx);
  });

  test("talkToSelf 调用 deliverToSelfMeta", async () => {
    const result = await api.talkToSelf("我需要反思一下");
    expect(deliverToSelfMetaCalled).toBe(true);
    expect(result).toContain("ReflectFlow");
  });

  test("talkToSelf 无 deliverToSelfMeta 且无 stoneDir 时返回错误", async () => {
    const resolver: ObjectResolver = {
      getTree: () => tree as any,
      objectExists: () => true,
    };
    const ctx2: CollaborationContext = {
      currentObjectName: "A",
      currentThreadId: "root_001",
      resolver,
      scheduler: scheduler as any,
      sessionDir: "/tmp/test-session",
      // 不提供 deliverToSelfMeta 也不提供 stoneDir
    };
    const api2 = createCollaborationAPI(ctx2);
    const result = await api2.talkToSelf("hello");
    expect(result).toContain("错误");
  });
});

describe("talkToSelf() — 方案 A 通过 stoneDir 路由到 reflect.ts", () => {
  let stoneDir: string;
  let tree: MockTree;
  let scheduler: MockScheduler;

  beforeEach(() => {
    stoneDir = join(tmpdir(), `collab-reflect-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);
    mkdirSync(stoneDir, { recursive: true });
    tree = new MockTree();
    scheduler = new MockScheduler();
  });

  afterEach(() => {
    if (existsSync(stoneDir)) rmSync(stoneDir, { recursive: true, force: true });
  });

  test("提供 stoneDir 时 talkToSelf 把消息写入 {stoneDir}/reflect/ 的根线程 inbox", async () => {
    const resolver: ObjectResolver = {
      getTree: () => tree as any,
      objectExists: () => true,
    };
    const ctx: CollaborationContext = {
      currentObjectName: "bruce",
      currentThreadId: "root_001",
      resolver,
      scheduler: scheduler as any,
      sessionDir: "/tmp/session",
      stoneDir,
    };
    const api = createCollaborationAPI(ctx);

    const result = await api.talkToSelf("G12 沉淀候选：X 做法效果显著");
    expect(result).toContain("已投递到反思线程");

    /* 从磁盘反查 reflect 线程树状态 */
    const reflectTree = ThreadsTree.load(join(stoneDir, "reflect"));
    expect(reflectTree).toBeTruthy();
    const data = reflectTree!.readThreadData(reflectTree!.rootId);
    expect(data?.inbox).toHaveLength(1);
    expect(data!.inbox![0]!.from).toBe("bruce");
    expect(data!.inbox![0]!.content).toBe("G12 沉淀候选：X 做法效果显著");
    expect(data!.inbox![0]!.source).toBe("system");
  });

  test("deliverToSelfMeta 优先级高于 stoneDir（override 语义）", async () => {
    let delivered = false;
    const resolver: ObjectResolver = {
      getTree: () => tree as any,
      objectExists: () => true,
    };
    const ctx: CollaborationContext = {
      currentObjectName: "bruce",
      currentThreadId: "root_001",
      resolver,
      scheduler: scheduler as any,
      sessionDir: "/tmp/session",
      stoneDir,
      deliverToSelfMeta: (_name, _msg) => { delivered = true; return "[override]"; },
    };
    const api = createCollaborationAPI(ctx);

    const result = await api.talkToSelf("test");
    expect(delivered).toBe(true);
    expect(result).toBe("[override]");

    /* stoneDir 路径不应被使用：reflect 目录里不应有 threads.json */
    expect(existsSync(join(stoneDir, "reflect", "threads.json"))).toBe(false);
  });

  test("resolver.getStoneDir 可作为 fallback 提供 stoneDir", async () => {
    const resolver: ObjectResolver = {
      getTree: () => tree as any,
      objectExists: () => true,
      getStoneDir: (name) => name === "bruce" ? stoneDir : null,
    };
    const ctx: CollaborationContext = {
      currentObjectName: "bruce",
      currentThreadId: "root_001",
      resolver,
      scheduler: scheduler as any,
      sessionDir: "/tmp/session",
      /* 不传 stoneDir，由 resolver 解析 */
    };
    const api = createCollaborationAPI(ctx);

    const result = await api.talkToSelf("从 resolver 取到 stoneDir 也应 work");
    expect(result).toContain("已投递到反思线程");

    const reflectTree = ThreadsTree.load(join(stoneDir, "reflect"));
    expect(reflectTree).toBeTruthy();
    const data = reflectTree!.readThreadData(reflectTree!.rootId);
    expect(data?.inbox).toHaveLength(1);
  });
});

describe("replyToFlow()", () => {
  let tree: MockTree;
  let scheduler: MockScheduler;
  let api: ReturnType<typeof createCollaborationAPI>;

  beforeEach(async () => {
    tree = new MockTree();
    scheduler = new MockScheduler();

    // 创建一个正在运行的子线程（模拟发起 talkToSelf 的线程）
    await tree.createSubThread("root_001", "正在执行的任务", {
      creatorThreadId: "root_001",
    });

    const resolver: ObjectResolver = {
      getTree: () => tree as any,
      objectExists: () => true,
    };

    // ReflectFlow 的上下文（currentThreadId 是 ReflectFlow 自己的线程）
    const ctx: CollaborationContext = {
      currentObjectName: "A",
      currentThreadId: "root_001",
      resolver,
      scheduler: scheduler as any,
      sessionDir: "/tmp/test-session",
    };

    api = createCollaborationAPI(ctx);
  });

  test("replyToFlow 将消息写入目标线程的 inbox", () => {
    // 获取子线程 ID（由 createSubThread 生成）
    const children = tree.getChildren("root_001");
    expect(children).toHaveLength(1);
    const targetThreadId = children[0]!.id;

    const result = api.replyToFlow(targetThreadId, "反思结果：应该优化缓存策略");

    // 目标线程的 inbox 收到消息（通过 tree.writeInbox）
    const targetData = tree.readThreadData(targetThreadId);
    expect(targetData?.inbox).toBeDefined();
    const inboxMsgs = targetData!.inbox!.filter(m => m.content === "反思结果：应该优化缓存策略");
    expect(inboxMsgs).toHaveLength(1);
    expect(inboxMsgs[0]!.source).toBe("system");
    expect(inboxMsgs[0]!.from).toContain("ReflectFlow");
    expect(inboxMsgs[0]!.status).toBe("unread");

    expect(result).toContain("已回复");
  });

  test("replyToFlow 目标线程不存在时返回错误", () => {
    const result = api.replyToFlow("nonexistent_thread", "hello");
    expect(result).toContain("错误");
  });
});

describe("talk 回复路由（onTalkHandlerReturn）", () => {
  let treeA: MockTree;
  let treeB: MockTree;
  let scheduler: MockScheduler;

  beforeEach(() => {
    treeA = new MockTree();
    treeB = new MockTree();
    scheduler = new MockScheduler();
  });

  test("H return 后，结果路由回 A 的 inbox + locals", async () => {
    const { onTalkHandlerReturn } = await import("../src/thread/collaboration.js");

    // 模拟 talk 已经创建了 W 和 H
    // W 在 A 侧（等待占位节点）
    const wId = await treeA.createSubThread("root_001", "等待 B 回复", {
      creatorThreadId: "root_001",
    });
    expect(wId).not.toBeNull();
    await treeA.setNodeStatus(wId!, "waiting");
    await treeA.awaitThreads("root_001", [wId!]);

    // H 在 B 侧（处理节点）
    const hId = await treeB.createSubThread("root_001", "处理 A 的请求", {
      creatorThreadId: "root_001",
      creatorObjectName: "A",
    });
    expect(hId).not.toBeNull();
    await treeB.setNodeStatus(hId!, "done");
    // 手动设置 linked 信息和 summary（实际由 collaboration.ts 在创建时设置）
    treeB.nodes[hId!].linkedWaitingNodeId = wId!;
    treeB.nodes[hId!].linkedWaitingObjectName = "A";
    treeB.nodes[hId!].summary = "搜索完成，找到 3 篇论文";

    const resolver: ObjectResolver = {
      getTree: (name) => (name === "A" ? treeA : treeB) as any,
      objectExists: () => true,
    };

    onTalkHandlerReturn(
      resolver,
      scheduler as any,
      "B",
      hId!,
      "搜索完成，找到 3 篇论文",
      { papers: ["paper1.pdf", "paper2.pdf", "paper3.pdf"] },
    );

    // 等待 checkAndWake 的 .then() 微任务完成
    await new Promise(resolve => setTimeout(resolve, 10));

    // W 节点变为 done
    expect(treeA.getNode(wId!)!.status).toBe("done");
    expect(treeA.getNode(wId!)!.summary).toBe("搜索完成，找到 3 篇论文");

    // A 的 root_001 inbox 收到回复（通过 tree.writeInbox）
    const aRootData = treeA.readThreadData("root_001");
    const talkMsgs = aRootData!.inbox!.filter(m => m.source === "talk");
    expect(talkMsgs).toHaveLength(1);
    expect(talkMsgs[0]!.content).toContain("搜索完成");

    // A 的 root_001 locals 收到 artifacts
    expect(aRootData!.locals?.papers).toEqual(["paper1.pdf", "paper2.pdf", "paper3.pdf"]);

    // A 的 root_001 被唤醒（awaitingChildren 全部 done）
    expect(treeA.getNode("root_001")!.status).toBe("running");
    expect(scheduler.woken).toHaveLength(1);
    expect(scheduler.woken[0]!.objectName).toBe("A");
    expect(scheduler.woken[0]!.nodeId).toBe("root_001");
  });
});
