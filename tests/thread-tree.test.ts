/**
 * ThreadsTree 内存模型测试
 *
 * @ref docs/superpowers/specs/2026-04-06-thread-tree-architecture-design.md
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { ThreadsTree } from "../src/thinkable/thread-tree/tree.js";
import { readThreadsTree, readThreadData } from "../src/storable/thread/persistence.js";

const TEST_DIR = join(import.meta.dir, ".tmp_thread_tree_test");

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

/* ========== 构造与 createRoot ========== */

describe("ThreadsTree 构造", () => {
  test("create 创建新树并持久化", async () => {
    const tree = await ThreadsTree.create(TEST_DIR, "研究任务");

    expect(tree.rootId).toBeTruthy();
    expect(tree.getNode(tree.rootId)!.title).toBe("研究任务");
    expect(tree.getNode(tree.rootId)!.status).toBe("running");
    expect(tree.getNode(tree.rootId)!.childrenIds).toEqual([]);

    // 验证 threads.json 已写入
    const persisted = readThreadsTree(TEST_DIR);
    expect(persisted).not.toBeNull();
    expect(persisted!.rootId).toBe(tree.rootId);

    // 验证 root 的 thread.json 已写入
    const threadData = readThreadData(join(TEST_DIR, "threads", tree.rootId));
    expect(threadData).not.toBeNull();
    expect(threadData!.id).toBe(tree.rootId);
    expect(threadData!.actions).toEqual([]);
  });

  test("load 从磁盘加载已有树", async () => {
    const tree1 = await ThreadsTree.create(TEST_DIR, "任务 A");
    const tree2 = ThreadsTree.load(TEST_DIR);

    expect(tree2).not.toBeNull();
    expect(tree2!.rootId).toBe(tree1.rootId);
    expect(tree2!.getNode(tree1.rootId)!.title).toBe("任务 A");
  });

  test("load 不存在时返回 null", () => {
    const tree = ThreadsTree.load(join(TEST_DIR, "nonexistent"));
    expect(tree).toBeNull();
  });
});

/* ========== createSubThread（think(fork) 底层 API） ========== */

describe("createSubThread", () => {
  test("创建子线程，父子关系正确", async () => {
    const tree = await ThreadsTree.create(TEST_DIR, "Root");
    const childId = await tree.createSubThread(tree.rootId, "子任务 A");

    expect(childId).toBeTruthy();

    // 子节点元数据
    const child = tree.getNode(childId!)!;
    expect(child.title).toBe("子任务 A");
    expect(child.status).toBe("pending");
    expect(child.parentId).toBe(tree.rootId);
    expect(child.creatorThreadId).toBe(tree.rootId);

    // 父节点 childrenIds 更新
    const root = tree.getNode(tree.rootId)!;
    expect(root.childrenIds).toContain(childId!);

    // 子线程的 thread.json 已创建
    const threadData = tree.readThreadData(childId!);
    expect(threadData).not.toBeNull();
    expect(threadData!.id).toBe(childId!);
  });

  test("创建子线程时可指定 traits 和 description", async () => {
    const tree = await ThreadsTree.create(TEST_DIR, "Root");
    const childId = await tree.createSubThread(tree.rootId, "搜索", {
      traits: ["web_search"],
      description: "搜索 AI safety 相关论文",
    });

    const child = tree.getNode(childId!)!;
    expect(child.traits).toEqual(["web_search"]);
    expect(child.description).toBe("搜索 AI safety 相关论文");
  });

  test("创建多个并行子线程", async () => {
    const tree = await ThreadsTree.create(TEST_DIR, "Root");

    const [id1, id2, id3] = await Promise.all([
      tree.createSubThread(tree.rootId, "搜索 X"),
      tree.createSubThread(tree.rootId, "搜索 Y"),
      tree.createSubThread(tree.rootId, "搜索 Z"),
    ]);

    const root = tree.getNode(tree.rootId)!;
    expect(root.childrenIds).toHaveLength(3);
    expect(root.childrenIds).toContain(id1!);
    expect(root.childrenIds).toContain(id2!);
    expect(root.childrenIds).toContain(id3!);
  });

  test("超过最大深度时返回 null", async () => {
    const tree = await ThreadsTree.create(TEST_DIR, "Root");

    // 构建 20 层深的链
    let parentId = tree.rootId;
    for (let i = 0; i < 19; i++) {
      parentId = (await tree.createSubThread(parentId, `层 ${i + 1}`))!;
    }

    // 第 21 层应该失败（Root 是第 0 层，已有 20 层）
    const tooDeep = await tree.createSubThread(parentId, "太深了");
    expect(tooDeep).toBeNull();
  });

  test("父节点不存在时返回 null", async () => {
    const tree = await ThreadsTree.create(TEST_DIR, "Root");
    const result = await tree.createSubThread("nonexistent", "子任务");
    expect(result).toBeNull();
  });
});

/* ========== return ========== */

describe("returnThread", () => {
  test("完成线程，写入 summary", async () => {
    const tree = await ThreadsTree.create(TEST_DIR, "Root");
    const childId = await tree.createSubThread(tree.rootId, "子任务");

    await tree.setNodeStatus(childId!, "running");
    await tree.returnThread(childId!, "任务完成，产出了报告");

    const child = tree.getNode(childId!)!;
    expect(child.status).toBe("done");
    expect(child.summary).toBe("任务完成，产出了报告");
  });

  test("完成线程，artifacts 写入创建者的 locals", async () => {
    const tree = await ThreadsTree.create(TEST_DIR, "Root");
    const childId = await tree.createSubThread(tree.rootId, "获取数据");

    await tree.setNodeStatus(childId!, "running");
    await tree.returnThread(childId!, "获取成功", {
      docContent: "文档内容...",
      docMeta: { title: "论文" },
    });

    // 验证 artifacts 写入创建者（Root）的 thread.json locals
    const rootData = tree.readThreadData(tree.rootId);
    expect(rootData).not.toBeNull();
    expect(rootData!.locals).toBeDefined();
    expect(rootData!.locals!["docContent"]).toBe("文档内容...");
    expect((rootData!.locals!["docMeta"] as any).title).toBe("论文");
  });

  test("完成线程，summary 写入创建者的 inbox", async () => {
    const tree = await ThreadsTree.create(TEST_DIR, "Root");
    const childId = await tree.createSubThread(tree.rootId, "子任务 B");

    await tree.setNodeStatus(childId!, "running");
    await tree.returnThread(childId!, "B 完成了");

    const rootData = tree.readThreadData(tree.rootId);
    expect(rootData!.inbox).toBeDefined();
    expect(rootData!.inbox!.length).toBeGreaterThanOrEqual(1);
    const msg = rootData!.inbox!.find(m => m.source === "system" && m.content.includes("B 完成了"));
    expect(msg).toBeDefined();
  });

  test("Root 节点不存在创建者，不写 inbox/locals", async () => {
    const tree = await ThreadsTree.create(TEST_DIR, "Root");

    // Root 自己 return 不应报错
    await tree.returnThread(tree.rootId, "全部完成");

    const root = tree.getNode(tree.rootId)!;
    expect(root.status).toBe("done");
    expect(root.summary).toBe("全部完成");
  });

  test("节点不存在时静默返回", async () => {
    const tree = await ThreadsTree.create(TEST_DIR, "Root");
    // 不应抛异常
    await tree.returnThread("nonexistent", "无效");
  });
});

/* ========== await / await_all ========== */

describe("awaitThreads", () => {
  test("await 单个子线程：设置 awaitingChildren + 状态变 waiting", async () => {
    const tree = await ThreadsTree.create(TEST_DIR, "Root");
    const childId = await tree.createSubThread(tree.rootId, "子任务");
    await tree.setNodeStatus(childId!, "running");

    await tree.awaitThreads(tree.rootId, [childId!]);

    const root = tree.getNode(tree.rootId)!;
    expect(root.status).toBe("waiting");
    expect(root.awaitingChildren).toEqual([childId!]);
  });

  test("await_all 多个子线程", async () => {
    const tree = await ThreadsTree.create(TEST_DIR, "Root");
    const id1 = await tree.createSubThread(tree.rootId, "A");
    const id2 = await tree.createSubThread(tree.rootId, "B");
    const id3 = await tree.createSubThread(tree.rootId, "C");

    await tree.awaitThreads(tree.rootId, [id1!, id2!, id3!]);

    const root = tree.getNode(tree.rootId)!;
    expect(root.status).toBe("waiting");
    expect(root.awaitingChildren).toEqual([id1!, id2!, id3!]);
  });

  test("子线程全部 done 后，checkAndWake 唤醒父线程", async () => {
    const tree = await ThreadsTree.create(TEST_DIR, "Root");
    const childId = await tree.createSubThread(tree.rootId, "子任务");
    await tree.setNodeStatus(childId!, "running");
    await tree.awaitThreads(tree.rootId, [childId!]);

    // 子线程完成
    await tree.returnThread(childId!, "完成");

    // 检查并唤醒
    const woken = await tree.checkAndWake(tree.rootId);
    expect(woken).toBe(true);

    const root = tree.getNode(tree.rootId)!;
    expect(root.status).toBe("running");
    expect(root.awaitingChildren).toBeUndefined();
  });

  test("部分子线程未完成时，checkAndWake 不唤醒", async () => {
    const tree = await ThreadsTree.create(TEST_DIR, "Root");
    const id1 = await tree.createSubThread(tree.rootId, "A");
    const id2 = await tree.createSubThread(tree.rootId, "B");
    await tree.setNodeStatus(id1!, "running");
    await tree.setNodeStatus(id2!, "running");
    await tree.awaitThreads(tree.rootId, [id1!, id2!]);

    // 只完成一个
    await tree.returnThread(id1!, "A 完成");

    const woken = await tree.checkAndWake(tree.rootId);
    expect(woken).toBe(false);

    const root = tree.getNode(tree.rootId)!;
    expect(root.status).toBe("waiting");
  });

  test("子线程 failed 也算完成，可以唤醒父线程", async () => {
    const tree = await ThreadsTree.create(TEST_DIR, "Root");
    const childId = await tree.createSubThread(tree.rootId, "子任务");
    await tree.setNodeStatus(childId!, "running");
    await tree.awaitThreads(tree.rootId, [childId!]);

    // 子线程失败
    await tree.setNodeStatus(childId!, "failed");

    const woken = await tree.checkAndWake(tree.rootId);
    expect(woken).toBe(true);

    const root = tree.getNode(tree.rootId)!;
    expect(root.status).toBe("running");
  });

  test("findWaitingParents 找到所有等待指定子线程的父节点", async () => {
    const tree = await ThreadsTree.create(TEST_DIR, "Root");
    const childId = await tree.createSubThread(tree.rootId, "子任务");
    await tree.setNodeStatus(childId!, "running");
    await tree.awaitThreads(tree.rootId, [childId!]);

    const waiters = tree.findWaitingParents(childId!);
    expect(waiters).toHaveLength(1);
    expect(waiters[0]).toBe(tree.rootId);
  });
});

/* ========== inbox 操作 ========== */

describe("inbox", () => {
  test("writeInbox 写入消息到指定线程", async () => {
    const tree = await ThreadsTree.create(TEST_DIR, "Root");

    tree.writeInbox(tree.rootId, {
      from: "helper",
      content: "搜索结果已准备好",
      source: "talk",
    });

    const data = tree.readThreadData(tree.rootId)!;
    expect(data.inbox).toHaveLength(1);
    expect(data.inbox![0]!.from).toBe("helper");
    expect(data.inbox![0]!.status).toBe("unread");
    expect(data.inbox![0]!.source).toBe("talk");
  });

  test("markInbox 标记消息", async () => {
    const tree = await ThreadsTree.create(TEST_DIR, "Root");

    tree.writeInbox(tree.rootId, {
      from: "A",
      content: "你好",
      source: "talk",
    });

    const data1 = tree.readThreadData(tree.rootId)!;
    const msgId = data1.inbox![0]!.id;

    tree.markInbox(tree.rootId, msgId, "ack", "已收到");

    const data2 = tree.readThreadData(tree.rootId)!;
    const msg = data2.inbox![0]!;
    expect(msg.status).toBe("marked");
    expect(msg.mark!.type).toBe("ack");
    expect(msg.mark!.tip).toBe("已收到");
  });

  test("markInbox todo 类型", async () => {
    const tree = await ThreadsTree.create(TEST_DIR, "Root");

    tree.writeInbox(tree.rootId, {
      from: "B",
      content: "请处理这个问题",
      source: "issue",
    });

    const data1 = tree.readThreadData(tree.rootId)!;
    const msgId = data1.inbox![0]!.id;

    tree.markInbox(tree.rootId, msgId, "todo", "需要处理");

    const data2 = tree.readThreadData(tree.rootId)!;
    expect(data2.inbox![0]!.mark!.type).toBe("todo");
  });

  test("inbox 溢出自动忽略最早消息（上限 50 条 unread）", async () => {
    const tree = await ThreadsTree.create(TEST_DIR, "Root");

    // 写入 51 条消息
    for (let i = 0; i < 51; i++) {
      tree.writeInbox(tree.rootId, {
        from: "sender",
        content: `消息 ${i}`,
        source: "system",
      });
    }

    const data = tree.readThreadData(tree.rootId)!;
    const unread = data.inbox!.filter(m => m.status === "unread");
    expect(unread.length).toBeLessThanOrEqual(50);

    // 最早的消息应该被自动 mark(ignore)
    const ignored = data.inbox!.filter(
      m => m.status === "marked" && m.mark?.type === "ignore"
    );
    expect(ignored.length).toBeGreaterThanOrEqual(1);
  });

  test("marked 消息超过 200 条时自动清理", async () => {
    const tree = await ThreadsTree.create(TEST_DIR, "Root");

    // 写入 210 条消息并全部 mark
    for (let i = 0; i < 210; i++) {
      tree.writeInbox(tree.rootId, {
        from: "sender",
        content: `消息 ${i}`,
        source: "system",
      });
    }

    const data1 = tree.readThreadData(tree.rootId)!;
    // mark 所有消息
    for (const msg of data1.inbox!) {
      tree.markInbox(tree.rootId, msg.id, "ack", "ok");
    }

    // 触发清理（下次 writeInbox 时检查）
    tree.writeInbox(tree.rootId, {
      from: "trigger",
      content: "触发清理",
      source: "system",
    });

    const data2 = tree.readThreadData(tree.rootId)!;
    const marked = data2.inbox!.filter(m => m.status === "marked");
    expect(marked.length).toBeLessThanOrEqual(100);
  });
});

/* ========== todo 操作 ========== */

describe("todo", () => {
  test("addTodo 创建 pending todo", async () => {
    const tree = await ThreadsTree.create(TEST_DIR, "Root");

    tree.addTodo(tree.rootId, "回复 A 的消息");

    const data = tree.readThreadData(tree.rootId)!;
    expect(data.todos).toHaveLength(1);
    expect(data.todos![0]!.content).toBe("回复 A 的消息");
    expect(data.todos![0]!.status).toBe("pending");
  });

  test("addTodo 关联 sourceMessageId", async () => {
    const tree = await ThreadsTree.create(TEST_DIR, "Root");

    tree.addTodo(tree.rootId, "处理问题", "msg_abc");

    const data = tree.readThreadData(tree.rootId)!;
    expect(data.todos![0]!.sourceMessageId).toBe("msg_abc");
  });

  test("completeTodo 标记 todo 完成", async () => {
    const tree = await ThreadsTree.create(TEST_DIR, "Root");

    tree.addTodo(tree.rootId, "任务 1");
    const data1 = tree.readThreadData(tree.rootId)!;
    const todoId = data1.todos![0]!.id;

    tree.completeTodo(tree.rootId, todoId);

    const data2 = tree.readThreadData(tree.rootId)!;
    expect(data2.todos![0]!.status).toBe("done");
    expect(data2.todos![0]!.doneAt).toBeDefined();
  });

  test("hasPendingTodos 检测未完成待办", async () => {
    const tree = await ThreadsTree.create(TEST_DIR, "Root");

    expect(tree.hasPendingTodos(tree.rootId)).toBe(false);

    tree.addTodo(tree.rootId, "任务 1");
    expect(tree.hasPendingTodos(tree.rootId)).toBe(true);

    const data = tree.readThreadData(tree.rootId)!;
    const todoId = data.todos![0]!.id;
    tree.completeTodo(tree.rootId, todoId);
    expect(tree.hasPendingTodos(tree.rootId)).toBe(false);
  });

  test("getPendingTodos 返回未完成待办列表", async () => {
    const tree = await ThreadsTree.create(TEST_DIR, "Root");

    tree.addTodo(tree.rootId, "任务 1");
    tree.addTodo(tree.rootId, "任务 2");
    tree.addTodo(tree.rootId, "任务 3");

    // 完成第一个
    const data = tree.readThreadData(tree.rootId)!;
    tree.completeTodo(tree.rootId, data.todos![0]!.id);

    const pending = tree.getPendingTodos(tree.rootId);
    expect(pending).toHaveLength(2);
    expect(pending[0]!.content).toBe("任务 2");
    expect(pending[1]!.content).toBe("任务 3");
  });
});
