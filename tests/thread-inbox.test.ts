/**
 * inbox 清理策略测试
 *
 * @ref docs/superpowers/specs/2026-04-06-thread-tree-architecture-design.md#3.3
 */
import { describe, test, expect } from "bun:test";
import { enforceInboxLimits } from "../src/thread/inbox.js";
import type { ThreadInboxMessage } from "../src/thread/types.js";

/** 辅助：生成 inbox 消息 */
function makeMsg(id: string, status: "unread" | "marked", timestamp: number): ThreadInboxMessage {
  return {
    id,
    from: "test",
    content: `msg-${id}`,
    timestamp,
    source: "talk",
    status,
    ...(status === "marked" ? { mark: { type: "ack", tip: "ok", markedAt: timestamp } } : {}),
  };
}

describe("enforceInboxLimits", () => {
  test("unread <= 50 时不做任何处理", () => {
    const inbox: ThreadInboxMessage[] = Array.from({ length: 50 }, (_, i) =>
      makeMsg(`u${i}`, "unread", 1000 + i),
    );
    const { cleaned, overflowed } = enforceInboxLimits(inbox);
    expect(cleaned).toHaveLength(50);
    expect(overflowed).toHaveLength(0);
    expect(cleaned.every((m) => m.status === "unread")).toBe(true);
  });

  test("unread > 50 时，最早的 unread 被自动 mark(ignore)", () => {
    const inbox: ThreadInboxMessage[] = Array.from({ length: 55 }, (_, i) =>
      makeMsg(`u${i}`, "unread", 1000 + i),
    );
    const { cleaned, overflowed } = enforceInboxLimits(inbox);
    // 5 条最早的被 mark(ignore)
    expect(overflowed).toHaveLength(5);
    expect(overflowed.every((m) => m.status === "marked" && m.mark?.type === "ignore")).toBe(true);
    // 剩余 50 条 unread
    const unreadCount = cleaned.filter((m) => m.status === "unread").length;
    expect(unreadCount).toBe(50);
    // 总数不变
    expect(cleaned).toHaveLength(55);
  });

  test("marked > 200 时，清理最早的 marked，保留最近 100 条", () => {
    const marked: ThreadInboxMessage[] = Array.from({ length: 210 }, (_, i) =>
      makeMsg(`m${i}`, "marked", 1000 + i),
    );
    const unread: ThreadInboxMessage[] = Array.from({ length: 10 }, (_, i) =>
      makeMsg(`u${i}`, "unread", 2000 + i),
    );
    const inbox = [...marked, ...unread];
    const { cleaned } = enforceInboxLimits(inbox);
    const markedCount = cleaned.filter((m) => m.status === "marked").length;
    expect(markedCount).toBe(100);
    const unreadCount = cleaned.filter((m) => m.status === "unread").length;
    expect(unreadCount).toBe(10);
  });

  test("空 inbox 不报错", () => {
    const { cleaned, overflowed } = enforceInboxLimits([]);
    expect(cleaned).toHaveLength(0);
    expect(overflowed).toHaveLength(0);
  });

  test("混合场景：unread 溢出 + marked 溢出同时处理", () => {
    const marked: ThreadInboxMessage[] = Array.from({ length: 205 }, (_, i) =>
      makeMsg(`m${i}`, "marked", 500 + i),
    );
    const unread: ThreadInboxMessage[] = Array.from({ length: 53 }, (_, i) =>
      makeMsg(`u${i}`, "unread", 1000 + i),
    );
    const inbox = [...marked, ...unread];
    const { cleaned, overflowed } = enforceInboxLimits(inbox);
    // 3 条 unread 溢出被 mark(ignore)
    expect(overflowed).toHaveLength(3);
    // unread 剩余 50
    const unreadCount = cleaned.filter((m) => m.status === "unread").length;
    expect(unreadCount).toBe(50);
    // marked 总数 = 原 205 + 溢出 3 = 208 → 清理到 100
    const markedCount = cleaned.filter((m) => m.status === "marked").length;
    expect(markedCount).toBe(100);
  });
});
