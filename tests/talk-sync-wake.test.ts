/**
 * B2 fix: writeInbox 唤醒 talk_sync 等待中的线程
 *
 * 场景：A 调用 talk_sync(target=B) 后进入 waiting+waitingType=talk_sync。
 * B 处理后回复（任何方式把消息写入 A 的 inbox）。
 * A 应该被唤醒（status: waiting → running, waitingType 清空）。
 *
 * @ref Bruce 深度验证 - B2 修复（Option B）
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { ThreadsTree } from "../src/thread/tree.js";

const TEST_DIR = join(import.meta.dir, ".tmp_talk_sync_wake_test");

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("writeInbox wakes talk_sync waiter (Option B)", () => {
  test("waiting + waitingType=talk_sync wakes when inbox receives msg", async () => {
    const tree = await ThreadsTree.create(TEST_DIR, "supervisor");
    const childId = await tree.createSubThread(tree.rootId, "talk_sync test");
    const nodeId = childId!;

    /* 模拟 talk_sync 进入等待 */
    await tree.setNodeStatus(nodeId, "waiting", "talk_sync");

    const before = tree.getNode(nodeId)!;
    expect(before.status).toBe("waiting");
    expect(before.waitingType).toBe("talk_sync");

    /* 写入 inbox 应该唤醒 */
    tree.writeInbox(nodeId, {
      from: "kernel",
      content: "reply",
      source: "talk",
    });

    const after = tree.getNode(nodeId)!;
    expect(after.status).toBe("running");
    expect(after.waitingType).toBeUndefined();
  });

  test("waiting + waitingType=await_children does NOT wake on inbox", async () => {
    const tree = await ThreadsTree.create(TEST_DIR, "supervisor");
    const childId = await tree.createSubThread(tree.rootId, "await children test");
    const nodeId = childId!;

    await tree.setNodeStatus(nodeId, "waiting", "await_children");

    tree.writeInbox(nodeId, {
      from: "noise",
      content: "noise",
      source: "system",
    });

    const after = tree.getNode(nodeId)!;
    expect(after.status).toBe("waiting");
    expect(after.waitingType).toBe("await_children");
  });

  test("waiting + waitingType=explicit_wait does NOT wake on inbox (LLM 主动 wait 语义)", async () => {
    const tree = await ThreadsTree.create(TEST_DIR, "supervisor");
    const childId = await tree.createSubThread(tree.rootId, "explicit wait test");
    const nodeId = childId!;

    await tree.setNodeStatus(nodeId, "waiting", "explicit_wait");

    tree.writeInbox(nodeId, {
      from: "noise",
      content: "noise",
      source: "system",
    });

    const after = tree.getNode(nodeId)!;
    expect(after.status).toBe("waiting");
    expect(after.waitingType).toBe("explicit_wait");
  });

  test("done node still triggers existing revival path (backward compat)", async () => {
    const tree = await ThreadsTree.create(TEST_DIR, "supervisor");
    const childId = await tree.createSubThread(tree.rootId, "revival test");
    const nodeId = childId!;

    await tree.setNodeStatus(nodeId, "running");
    /* returnThread sets status to done */
    await tree.returnThread(nodeId, "完成");

    const before = tree.getNode(nodeId)!;
    expect(before.status).toBe("done");

    tree.writeInbox(nodeId, {
      from: "user",
      content: "wake",
      source: "talk",
    });

    const after = tree.getNode(nodeId)!;
    /* done → running per existing revival logic */
    expect(after.status).toBe("running");
    expect(after.revivalCount).toBe(1);
  });
});
