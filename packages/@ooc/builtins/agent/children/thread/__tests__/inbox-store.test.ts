import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { THREAD_CLASS_ID } from "@ooc/core/types/constants.js";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { saveObject, loadObject } from "@ooc/core/persistable/runtime-object-io.js";
import { persistInboxMessages, readInboxMessages } from "../persistable/inbox-store";
import type { ThreadContext, ThreadMessage } from "@ooc/builtins/agent/thread/types.js";

/**
 * Inbox 独立存储 — collaborable 并发回报竞态根治回归（thread builtin 自有持久化逻辑）。
 *
 * 核心场景：worker 持 caller in-memory 跑很久，期间外部 deliverTalkMessage append 新消息；
 * worker 跑完用它的 stale in-memory inbox writeThread。旧实现（inbox 在 thread.json）下
 * worker 整体覆盖 → 外部 append 丢失。新实现（inbox per-message 目录 append-only）下
 * writeThread 只增不删 → 两条都存活。
 */
const mkMsg = (id: string, createdAt: number): ThreadMessage => ({
  id,
  fromThreadId: "sender",
  toThreadId: "root",
  content: `content-${id}`,
  createdAt,
  source: "talk",
});

function mkThread(baseDir: string, inbox: ThreadMessage[]): ThreadContext {
  return {
    id: "root",
    class: "_builtin/agent/thread",
    status: "running",
    events: [],
    contextWindows: [],
    inbox,
    persistence: { baseDir, sessionId: "s1", objectId: "agent_a", threadId: "root" },
  } as ThreadContext;
}

describe("inbox-store append-only 并发安全", () => {
  test("worker stale in-memory writeThread 不覆盖外部并发 append 的 inbox（核心竞态根治）", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "ooc-inbox-"));
    try {
      const ref = { baseDir, sessionId: "s1", objectId: "agent_a", threadId: "root" };

      // 初始：inbox=[msg1]
      await saveObject(mkThread(baseDir, [mkMsg("msg1", 1)]));

      // worker 读到含 msg1 的快照（in-memory，模拟它将跑很久）
      const workerView = await loadObject(THREAD_CLASS_ID, ref, "root");
      expect(workerView!.inbox!.map((m) => m.id)).toEqual(["msg1"]);

      // 外部并发（deliverTalkMessage）：read → append msg2 → writeThread
      const external = await loadObject(THREAD_CLASS_ID, ref, "root");
      external!.inbox = [...(external!.inbox ?? []), mkMsg("msg2", 2)];
      await saveObject(external!);

      // worker 跑完，用它的 stale view（只含 msg1）writeThread
      await saveObject(workerView!);

      // 根治断言：msg1 + msg2 都在（旧实现下 workerView 整体覆盖 → 只剩 msg1）
      const final = await loadObject(THREAD_CLASS_ID, ref, "root");
      expect(final!.inbox!.map((m) => m.id).sort()).toEqual(["msg1", "msg2"]);
    } finally {
      await rm(baseDir, { recursive: true, force: true });
    }
  });

  test("N 路并发 append 同一 thread 全部存活（last-write-wins 覆盖根治）", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "ooc-inbox-"));
    try {
      const ref = { baseDir, sessionId: "s1", objectId: "agent_a", threadId: "root" };
      await saveObject(mkThread(baseDir, []));

      // 5 路并发：各自 read 同一空 inbox → append 自己一条 → writeThread（都基于 stale v0）
      await Promise.all(
        Array.from({ length: 5 }, async (_unused, i) => {
          const t = await loadObject(THREAD_CLASS_ID, ref, "root");
          t!.inbox = [...(t!.inbox ?? []), mkMsg(`p${i}`, i)];
          await saveObject(t!);
        }),
      );

      const final = await loadObject(THREAD_CLASS_ID, ref, "root");
      expect(final!.inbox!.map((m) => m.id).sort()).toEqual(["p0", "p1", "p2", "p3", "p4"]);
    } finally {
      await rm(baseDir, { recursive: true, force: true });
    }
  });

  test("persistInboxMessages 幂等（同 msgId 不重写、不重复）", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "ooc-inbox-"));
    try {
      const ref = { baseDir, sessionId: "s1", objectId: "agent_a", threadId: "root" };
      await persistInboxMessages(ref, [mkMsg("dup", 1)]);
      await persistInboxMessages(ref, [mkMsg("dup", 1), mkMsg("new", 2)]);
      const msgs = await readInboxMessages(ref);
      expect(msgs.map((m) => m.id).sort()).toEqual(["dup", "new"]);
    } finally {
      await rm(baseDir, { recursive: true, force: true });
    }
  });
});
