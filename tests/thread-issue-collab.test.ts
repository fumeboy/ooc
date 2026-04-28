/**
 * Issue 协作集成测试
 *
 * 测试 commentOnIssue 时 @某人 → 在对方 Root 下创建 issue 对应的 thread。
 * 同一 Issue 不重复创建 thread。
 *
 * @ref docs/superpowers/specs/2026-04-06-thread-tree-architecture-design.md#9.2
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  commentOnIssueWithNotify,
  type ObjectResolver,
} from "../src/collaborable/talk/collaboration.js";
import type { ThreadsTreeNodeMeta, ThreadInboxMessage, ThreadStatus } from "../src/thinkable/thread-tree/types.js";
import { createIssue } from "../src/collaborable/kanban/methods.js";

const TEST_DIR = join(import.meta.dir, ".tmp_issue_collab_test");

/* ========== Mock 基础设施（简化版，复用 Task 2 的 MockTree 模式） ========== */

/**
 * Issue 测试用 MockTree — 匹配 ThreadsTree 真实 API
 * 与 Task 2 的 MockTree 相同结构，但简化（只需 Issue 协作用到的方法）
 */
class MockTree {
  nodes: Record<string, ThreadsTreeNodeMeta> = {};
  threadData: Record<string, { id: string; events: any[]; inbox?: ThreadInboxMessage[]; locals?: Record<string, unknown> }> = {};
  private _rootId = "root_001";
  private _nextId = 0;

  constructor() {
    const now = Date.now();
    this.nodes["root_001"] = {
      id: "root_001", title: "Root", status: "running",
      childrenIds: [], createdAt: now, updatedAt: now,
    };
    this.threadData["root_001"] = { id: "root_001", events: [] };
  }

  get rootId() { return this._rootId; }
  getNode(id: string) { return this.nodes[id] ? { ...this.nodes[id] } : null; }
  getChildren(id: string) {
    const node = this.nodes[id];
    if (!node) return [];
    return node.childrenIds.map((cid) => this.nodes[cid]!).filter(Boolean).map(n => ({ ...n }));
  }
  async createSubThread(parentId: string, title: string, options?: {
    description?: string; creatorThreadId?: string; creatorObjectName?: string;
    linkedWaitingNodeId?: string; linkedWaitingObjectName?: string;
    creationMode?: string;
  }): Promise<string | null> {
    const parent = this.nodes[parentId];
    if (!parent) return null;
    const id = `th_mock_${this._nextId++}`;
    const now = Date.now();
    parent.childrenIds.push(id);
    this.nodes[id] = {
      id, title, description: options?.description,
      status: "pending", parentId, childrenIds: [],
      creatorThreadId: options?.creatorThreadId,
      creatorObjectName: options?.creatorObjectName,
      createdAt: now, updatedAt: now,
    };
    this.threadData[id] = { id, events: [] };
    return id;
  }
  async setNodeStatus(nodeId: string, status: ThreadStatus): Promise<void> {
    const node = this.nodes[nodeId];
    if (node) { node.status = status; node.updatedAt = Date.now(); }
  }
  writeInbox(nodeId: string, msg: { from: string; content: string; source: ThreadInboxMessage["source"]; issueId?: string }): void {
    const data = this.threadData[nodeId];
    if (!data) return;
    if (!data.inbox) data.inbox = [];
    data.inbox.push({
      id: `msg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      from: msg.from, content: msg.content, timestamp: Date.now(),
      source: msg.source, issueId: msg.issueId, status: "unread",
    });
  }
  readThreadData(nodeId: string) { return this.threadData[nodeId] ?? null; }
  writeThreadData(nodeId: string, data: any) { this.threadData[nodeId] = data; }
}

class MockScheduler {
  started: { objectName: string; nodeId: string }[] = [];
  startThread(objectName: string, nodeId: string) {
    this.started.push({ objectName, nodeId });
  }
  wakeThread() {}
}

/* ========== 测试 ========== */

describe("Issue 协作集成", () => {
  let treeA: MockTree;
  let treeB: MockTree;
  let treeC: MockTree;
  let scheduler: MockScheduler;
  let resolver: ObjectResolver;
  let sessionDir: string;
  let issueId: string;

  beforeEach(async () => {
    treeA = new MockTree();
    treeB = new MockTree();
    treeC = new MockTree();
    scheduler = new MockScheduler();

    const trees: Record<string, MockTree> = { A: treeA, B: treeB, C: treeC };

    resolver = {
      getTree: (name) => trees[name] as any,
      objectExists: (name) => name in trees,
    };

    sessionDir = join(TEST_DIR, `session_${Date.now()}`);
    mkdirSync(sessionDir, { recursive: true });

    // I3: 捕获 createIssue 返回的 Issue 对象，使用其 .id
    const issue = await createIssue(sessionDir, "讨论 AI safety 方案", "需要多方讨论", ["A", "B", "C"]);
    issueId = issue.id;
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  test("commentOnIssue @B → B 的 Root 下创建 issue thread", async () => {
    await commentOnIssueWithNotify(
      sessionDir, resolver, scheduler as any,
      issueId, "A", "我认为应该优先考虑对齐问题", ["B"],
    );

    // B 的 Root 下创建了 issue thread
    const bChildren = treeB.getChildren("root_001");
    expect(bChildren).toHaveLength(1);
    const issueThread = bChildren[0]!;
    expect(issueThread.title).toContain("Issue");
    expect(issueThread.description).toContain(`[issue:${issueId}]`);

    // issue thread 的 inbox 收到通知（通过 tree.readThreadData）
    const threadData = treeB.readThreadData(issueThread.id);
    expect(threadData?.inbox).toHaveLength(1);
    expect(threadData!.inbox![0]!.source).toBe("issue");
    expect(threadData!.inbox![0]!.issueId).toBe(issueId);
    expect(threadData!.inbox![0]!.content).toContain("对齐问题");

    // Scheduler 启动了 issue thread
    expect(scheduler.started).toHaveLength(1);
    expect(scheduler.started[0]!.objectName).toBe("B");
  });

  test("同一 Issue 不重复创建 thread", async () => {
    // 第一次 @B
    await commentOnIssueWithNotify(
      sessionDir, resolver, scheduler as any,
      issueId, "A", "第一条评论", ["B"],
    );

    // 第二次 @B（同一 Issue）
    await commentOnIssueWithNotify(
      sessionDir, resolver, scheduler as any,
      issueId, "C", "第二条评论", ["B"],
    );

    // B 的 Root 下仍然只有 1 个 issue thread
    const bChildren = treeB.getChildren("root_001");
    expect(bChildren).toHaveLength(1);

    // 但 inbox 有 2 条消息（通过 tree.readThreadData）
    const threadData = treeB.readThreadData(bChildren[0]!.id);
    expect(threadData?.inbox).toHaveLength(2);
  });

  test("@多人时，每人各创建一个 issue thread", async () => {
    await commentOnIssueWithNotify(
      sessionDir, resolver, scheduler as any,
      issueId, "A", "大家怎么看？", ["B", "C"],
    );

    const bChildren = treeB.getChildren("root_001");
    expect(bChildren).toHaveLength(1);

    const cChildren = treeC.getChildren("root_001");
    expect(cChildren).toHaveLength(1);

    expect(scheduler.started).toHaveLength(2);
  });

  test("@自己时不创建 thread", async () => {
    await commentOnIssueWithNotify(
      sessionDir, resolver, scheduler as any,
      issueId, "A", "自言自语", ["A"],
    );

    const aChildren = treeA.getChildren("root_001");
    expect(aChildren).toHaveLength(0);
    expect(scheduler.started).toHaveLength(0);
  });
});
