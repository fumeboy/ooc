/**
 * waitingType 字段消歧测试
 *
 * 验证三种 waiting 语义在 ThreadsTreeNodeMeta 上都能正确写入 waitingType。
 *
 * @ref docs/superpowers/specs/2026-04-06-thread-tree-architecture-design.md
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { ThreadsTree } from "../src/thread/tree.js";
import { readThreadsTree } from "../src/thread/persistence.js";

const TEST_DIR = join(import.meta.dir, ".tmp_waiting_type_test");

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("waitingType 字段消歧", () => {
  test("awaitThreads 写入 await_children", async () => {
    const tree = await ThreadsTree.create(TEST_DIR, "Root");

    // 创建一个子线程作为被等待对象
    const childId = await tree.createSubThread(tree.rootId, "子任务");
    expect(childId).toBeTruthy();

    // 触发 await_children 路径
    await tree.awaitThreads(tree.rootId, [childId!]);

    const node = tree.getNode(tree.rootId)!;
    expect(node.status).toBe("waiting");
    expect(node.waitingType).toBe("await_children");

    // 验证字段通过 JSON 持久化后能正确还原
    const persisted = readThreadsTree(TEST_DIR);
    expect(persisted!.nodes[tree.rootId]!.waitingType).toBe("await_children");
  });

  test("setNodeStatus('waiting', 'explicit_wait') 写入 explicit_wait", async () => {
    const tree = await ThreadsTree.create(TEST_DIR, "Root");

    // 触发 explicit_wait 路径（对应 wait 工具）
    await tree.setNodeStatus(tree.rootId, "waiting", "explicit_wait");

    const node = tree.getNode(tree.rootId)!;
    expect(node.status).toBe("waiting");
    expect(node.waitingType).toBe("explicit_wait");

    // 验证字段通过 JSON 持久化后能正确还原
    const persisted = readThreadsTree(TEST_DIR);
    expect(persisted!.nodes[tree.rootId]!.waitingType).toBe("explicit_wait");
  });

  test("setNodeStatus('waiting', 'talk_sync') 写入 talk_sync", async () => {
    const tree = await ThreadsTree.create(TEST_DIR, "Root");

    // 触发 talk_sync 路径
    await tree.setNodeStatus(tree.rootId, "waiting", "talk_sync");

    const node = tree.getNode(tree.rootId)!;
    expect(node.status).toBe("waiting");
    expect(node.waitingType).toBe("talk_sync");

    // 验证字段通过 JSON 持久化后能正确还原
    const persisted = readThreadsTree(TEST_DIR);
    expect(persisted!.nodes[tree.rootId]!.waitingType).toBe("talk_sync");
  });

  test("setNodeStatus 非 waiting 状态时清除 waitingType", async () => {
    const tree = await ThreadsTree.create(TEST_DIR, "Root");

    // 先进入 waiting 状态
    await tree.setNodeStatus(tree.rootId, "waiting", "explicit_wait");
    expect(tree.getNode(tree.rootId)!.waitingType).toBe("explicit_wait");

    // 转换为非 waiting 状态，waitingType 应被清除
    await tree.setNodeStatus(tree.rootId, "running");

    const node = tree.getNode(tree.rootId)!;
    expect(node.status).toBe("running");
    expect(node.waitingType).toBeUndefined();
  });

  test("checkAndWake 唤醒后清除 waitingType", async () => {
    const tree = await ThreadsTree.create(TEST_DIR, "Root");

    // 创建子线程并进入等待
    const childId = await tree.createSubThread(tree.rootId, "子任务");
    await tree.awaitThreads(tree.rootId, [childId!]);
    expect(tree.getNode(tree.rootId)!.waitingType).toBe("await_children");

    // 子线程完成
    await tree.setNodeStatus(childId!, "running");
    await tree.returnThread(childId!, "done");

    // 唤醒父线程
    await tree.checkAndWake(tree.rootId);

    const node = tree.getNode(tree.rootId)!;
    expect(node.status).toBe("running");
    expect(node.waitingType).toBeUndefined();
  });
});
