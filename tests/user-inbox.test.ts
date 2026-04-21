/**
 * User Inbox 持久化单元测试
 *
 * 验证：
 * 1. appendUserInbox 首次调用能创建目录 + data.json
 * 2. 多次 append 按时间顺序追加（不去重）
 * 3. 并发 append 不丢数据（per-session 串行化）
 * 4. readUserInbox 对不存在的 session 返回 { inbox: [] }
 *
 * @ref docs/工程管理/迭代/all/20260421_feature_user_inbox.md
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

import { appendUserInbox, readUserInbox } from "../src/persistence/user-inbox.js";

const TEST_DIR = join(import.meta.dir, ".tmp_user_inbox_test");
const FLOWS_DIR = join(TEST_DIR, "flows");

beforeEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
  mkdirSync(FLOWS_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("appendUserInbox", () => {
  test("首次 append 能创建 session/user 目录和 data.json", async () => {
    const sid = "s_test_first";
    await appendUserInbox(FLOWS_DIR, sid, "th_1", "msg_1");

    const userDir = join(FLOWS_DIR, sid, "user");
    const dataJson = join(userDir, "data.json");

    expect(existsSync(userDir)).toBe(true);
    expect(existsSync(dataJson)).toBe(true);

    const parsed = JSON.parse(readFileSync(dataJson, "utf-8"));
    expect(parsed).toEqual({ inbox: [{ threadId: "th_1", messageId: "msg_1" }] });
  });

  test("多次 append 按顺序追加，不去重", async () => {
    const sid = "s_test_append";
    await appendUserInbox(FLOWS_DIR, sid, "th_a", "msg_1");
    await appendUserInbox(FLOWS_DIR, sid, "th_a", "msg_2");
    await appendUserInbox(FLOWS_DIR, sid, "th_b", "msg_3");
    /* 同线程重复消息也追加（按 Alpha 语义：允许重复） */
    await appendUserInbox(FLOWS_DIR, sid, "th_a", "msg_1");

    const data = await readUserInbox(FLOWS_DIR, sid);
    expect(data.inbox).toEqual([
      { threadId: "th_a", messageId: "msg_1" },
      { threadId: "th_a", messageId: "msg_2" },
      { threadId: "th_b", messageId: "msg_3" },
      { threadId: "th_a", messageId: "msg_1" },
    ]);
  });

  test("并发 10 次 append 全部写入、无丢失", async () => {
    const sid = "s_test_concurrent";
    const writes = Array.from({ length: 10 }, (_, i) =>
      appendUserInbox(FLOWS_DIR, sid, `th_${i}`, `msg_${i}`),
    );
    await Promise.all(writes);

    const data = await readUserInbox(FLOWS_DIR, sid);
    expect(data.inbox.length).toBe(10);

    /* 10 条 messageId 全部出现（顺序可能与 enqueue 顺序一致） */
    const ids = new Set(data.inbox.map((e) => e.messageId));
    for (let i = 0; i < 10; i++) {
      expect(ids.has(`msg_${i}`)).toBe(true);
    }
  });

  test("不同 session 的 append 互不干扰", async () => {
    await appendUserInbox(FLOWS_DIR, "s_a", "th_1", "msg_a1");
    await appendUserInbox(FLOWS_DIR, "s_b", "th_2", "msg_b1");
    await appendUserInbox(FLOWS_DIR, "s_a", "th_1", "msg_a2");

    const a = await readUserInbox(FLOWS_DIR, "s_a");
    const b = await readUserInbox(FLOWS_DIR, "s_b");
    expect(a.inbox.length).toBe(2);
    expect(b.inbox.length).toBe(1);
    expect(b.inbox[0]?.messageId).toBe("msg_b1");
  });
});

describe("readUserInbox", () => {
  test("不存在的 session 返回 { inbox: [] }", async () => {
    const data = await readUserInbox(FLOWS_DIR, "s_nonexistent");
    expect(data).toEqual({ inbox: [] });
  });

  test("session 存在但 user/data.json 不存在也返回 { inbox: [] }", async () => {
    const sid = "s_exists_but_no_user";
    mkdirSync(join(FLOWS_DIR, sid), { recursive: true });
    const data = await readUserInbox(FLOWS_DIR, sid);
    expect(data).toEqual({ inbox: [] });
  });

  test("损坏的 data.json 返回 { inbox: [] }（容错）", async () => {
    const sid = "s_corrupted";
    const userDir = join(FLOWS_DIR, sid, "user");
    mkdirSync(userDir, { recursive: true });
    const dataJson = join(userDir, "data.json");
    /* 写入非法 JSON */
    const fs = await import("node:fs/promises");
    await fs.writeFile(dataJson, "not a json {{{", "utf-8");

    const data = await readUserInbox(FLOWS_DIR, sid);
    expect(data).toEqual({ inbox: [] });
  });

  test("data.json 存在但无 inbox 字段时返回 { inbox: [] }", async () => {
    /* 兼容未来扩展：user/data.json 可能有其他字段但没 inbox */
    const sid = "s_no_inbox_field";
    const userDir = join(FLOWS_DIR, sid, "user");
    mkdirSync(userDir, { recursive: true });
    const fs = await import("node:fs/promises");
    await fs.writeFile(join(userDir, "data.json"), JSON.stringify({ other: "field" }), "utf-8");

    const data = await readUserInbox(FLOWS_DIR, sid);
    expect(data).toEqual({ inbox: [] });
  });
});
