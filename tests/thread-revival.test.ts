/**
 * Thread Revival 测试 — done 线程收到 inbox 消息后自动复活
 *
 * @ref docs/superpowers/specs/2026-04-20-thread-revival-design.md
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { ThreadsTree } from "../src/thread/tree.js";

const TEST_DIR = join(import.meta.dir, ".tmp_thread_revival_test");

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

/* ========== 基本复活 ========== */

describe("Thread Revival — writeInbox 自动唤醒 done 线程", () => {
  test("done 线程收到消息后变为 running", async () => {
    const tree = await ThreadsTree.create(TEST_DIR, "Root");
    const childId = await tree.createSubThread(tree.rootId, "子任务");
    expect(childId).toBeTruthy();

    /* 子线程完成 */
    await tree.setNodeStatus(childId!, "running");
    await tree.returnThread(childId!, "第一次完成");

    const doneNode = tree.getNode(childId!)!;
    expect(doneNode.status).toBe("done");
    expect(doneNode.summary).toBe("第一次完成");

    /* 向 done 线程发消息 → 应自动复活 */
    tree.writeInbox(childId!, {
      from: "user",
      content: "请继续处理",
      source: "talk",
    });

    const revivedNode = tree.getNode(childId!)!;
    expect(revivedNode.status).toBe("running");
    expect(revivedNode.revivalCount).toBe(1);
    /* summary 保留 */
    expect(revivedNode.summary).toBe("第一次完成");
  });

  test("多次复活 revivalCount 递增", async () => {
    const tree = await ThreadsTree.create(TEST_DIR, "Root");
    const childId = await tree.createSubThread(tree.rootId, "子任务");
    await tree.setNodeStatus(childId!, "running");

    /* 第一次完成 + 复活 */
    await tree.returnThread(childId!, "完成 1");
    tree.writeInbox(childId!, { from: "a", content: "msg1", source: "talk" });
    expect(tree.getNode(childId!)!.revivalCount).toBe(1);
    expect(tree.getNode(childId!)!.status).toBe("running");

    /* 第二次完成 + 复活 */
    await tree.returnThread(childId!, "完成 2");
    tree.writeInbox(childId!, { from: "b", content: "msg2", source: "system" });
    expect(tree.getNode(childId!)!.revivalCount).toBe(2);
    expect(tree.getNode(childId!)!.status).toBe("running");
    /* summary 被第二次 return 覆盖 */
    expect(tree.getNode(childId!)!.summary).toBe("完成 2");
  });

  test("running 线程收到消息不触发复活", async () => {
    const tree = await ThreadsTree.create(TEST_DIR, "Root");
    const childId = await tree.createSubThread(tree.rootId, "子任务");
    await tree.setNodeStatus(childId!, "running");

    tree.writeInbox(childId!, { from: "a", content: "msg", source: "talk" });

    const node = tree.getNode(childId!)!;
    expect(node.status).toBe("running");
    expect(node.revivalCount).toBeUndefined();
  });

  test("waiting 线程收到消息不触发复活", async () => {
    const tree = await ThreadsTree.create(TEST_DIR, "Root");
    const childId = await tree.createSubThread(tree.rootId, "子任务");
    await tree.setNodeStatus(childId!, "waiting");

    tree.writeInbox(childId!, { from: "a", content: "msg", source: "talk" });

    expect(tree.getNode(childId!)!.status).toBe("waiting");
  });

  test("failed 线程收到消息不触发复活", async () => {
    const tree = await ThreadsTree.create(TEST_DIR, "Root");
    const childId = await tree.createSubThread(tree.rootId, "子任务");
    await tree.setNodeStatus(childId!, "failed");

    tree.writeInbox(childId!, { from: "a", content: "msg", source: "talk" });

    expect(tree.getNode(childId!)!.status).toBe("failed");
  });
});

/* ========== 回调通知 ========== */

describe("Thread Revival — 回调通知", () => {
  test("复活时触发 onRevival 回调", async () => {
    const tree = await ThreadsTree.create(TEST_DIR, "Root");
    const childId = await tree.createSubThread(tree.rootId, "子任务");
    await tree.setNodeStatus(childId!, "running");
    await tree.returnThread(childId!, "done");

    const revived: string[] = [];
    tree.setRevivalCallback((nodeId) => revived.push(nodeId));

    tree.writeInbox(childId!, { from: "a", content: "wake up", source: "talk" });

    expect(revived).toEqual([childId!]);
  });

  test("非 done 线程不触发回调", async () => {
    const tree = await ThreadsTree.create(TEST_DIR, "Root");
    const childId = await tree.createSubThread(tree.rootId, "子任务");
    await tree.setNodeStatus(childId!, "running");

    const revived: string[] = [];
    tree.setRevivalCallback((nodeId) => revived.push(nodeId));

    tree.writeInbox(childId!, { from: "a", content: "msg", source: "talk" });

    expect(revived).toEqual([]);
  });

  test("多条消息同时到达只触发一次回调", async () => {
    const tree = await ThreadsTree.create(TEST_DIR, "Root");
    const childId = await tree.createSubThread(tree.rootId, "子任务");
    await tree.setNodeStatus(childId!, "running");
    await tree.returnThread(childId!, "done");

    const revived: string[] = [];
    tree.setRevivalCallback((nodeId) => revived.push(nodeId));

    /* 第一条消息触发复活 */
    tree.writeInbox(childId!, { from: "a", content: "msg1", source: "talk" });
    /* 第二条消息时线程已经 running，不再触发 */
    tree.writeInbox(childId!, { from: "b", content: "msg2", source: "talk" });

    expect(revived).toEqual([childId!]);
    expect(tree.getNode(childId!)!.revivalCount).toBe(1);
  });
});

/* ========== 父线程不受影响 ========== */

describe("Thread Revival — 父线程隔离", () => {
  test("子线程复活不影响父线程状态", async () => {
    const tree = await ThreadsTree.create(TEST_DIR, "Root");
    const childId = await tree.createSubThread(tree.rootId, "子任务");
    await tree.setNodeStatus(childId!, "running");

    /* 父线程 await 子线程 */
    await tree.awaitThreads(tree.rootId, [childId!]);
    expect(tree.getNode(tree.rootId)!.status).toBe("waiting");

    /* 子线程完成 → 父线程被唤醒 */
    await tree.returnThread(childId!, "完成");
    const woken = await tree.checkAndWake(tree.rootId);
    expect(woken).toBe(true);
    expect(tree.getNode(tree.rootId)!.status).toBe("running");

    /* 子线程复活 → 父线程不受影响 */
    tree.writeInbox(childId!, { from: "a", content: "继续", source: "talk" });
    expect(tree.getNode(childId!)!.status).toBe("running");
    expect(tree.getNode(tree.rootId)!.status).toBe("running");
    /* 父线程的 awaitingChildren 已被清除 */
    expect(tree.getNode(tree.rootId)!.awaitingChildren).toBeUndefined();
  });
});
