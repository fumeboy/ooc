/**
 * User Inbox Read-State 持久化测试
 *
 * 验证 `flows/{sessionId}/user/data.json` 的 readState 字段：
 * - readUserReadState：默认空对象、返回 `lastReadTimestampByObject`
 * - setUserReadObject：追加/覆盖某对象的 lastReadAt（单调递增：只在传入 ts 更大时才更新）
 * - readUserInbox：返回合并后的 readState 字段
 * - 与 appendUserInbox 并存：两个 API 互不破坏彼此的数据
 *
 * @ref docs/工程管理/迭代/all/20260421_feature_user_inbox_read_state.md
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdirSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  appendUserInbox,
  readUserInbox,
  readUserReadState,
  setUserReadObject,
} from "../src/storable/inbox/user-inbox.js";

const TEST_DIR = join(import.meta.dir, ".tmp_user_inbox_read_state_test");
const FLOWS_DIR = join(TEST_DIR, "flows");

beforeEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
  mkdirSync(FLOWS_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("readUserReadState", () => {
  test("文件不存在返回空对象", async () => {
    const state = await readUserReadState(FLOWS_DIR, "s_missing");
    expect(state).toEqual({ lastReadTimestampByObject: {} });
  });

  test("只有 inbox 没 readState 字段时返回空对象", async () => {
    await appendUserInbox(FLOWS_DIR, "s_inbox_only", "th_1", "msg_1");
    const state = await readUserReadState(FLOWS_DIR, "s_inbox_only");
    expect(state).toEqual({ lastReadTimestampByObject: {} });
  });
});

describe("setUserReadObject", () => {
  test("首次设置后可读回", async () => {
    await setUserReadObject(FLOWS_DIR, "s_set1", "bruce", 1000);
    const state = await readUserReadState(FLOWS_DIR, "s_set1");
    expect(state.lastReadTimestampByObject.bruce).toBe(1000);
  });

  test("同对象 ts 更大时更新，更小时保持原值（单调递增）", async () => {
    await setUserReadObject(FLOWS_DIR, "s_mono", "bruce", 2000);
    await setUserReadObject(FLOWS_DIR, "s_mono", "bruce", 1500); // 更小，忽略
    let state = await readUserReadState(FLOWS_DIR, "s_mono");
    expect(state.lastReadTimestampByObject.bruce).toBe(2000);

    await setUserReadObject(FLOWS_DIR, "s_mono", "bruce", 3000); // 更大，更新
    state = await readUserReadState(FLOWS_DIR, "s_mono");
    expect(state.lastReadTimestampByObject.bruce).toBe(3000);
  });

  test("多个对象独立记录", async () => {
    await setUserReadObject(FLOWS_DIR, "s_multi", "bruce", 1000);
    await setUserReadObject(FLOWS_DIR, "s_multi", "iris", 2000);
    const state = await readUserReadState(FLOWS_DIR, "s_multi");
    expect(state.lastReadTimestampByObject).toEqual({ bruce: 1000, iris: 2000 });
  });

  test("与 inbox 并存：setUserReadObject 不破坏 inbox，反之亦然", async () => {
    await appendUserInbox(FLOWS_DIR, "s_coexist", "th_1", "msg_1");
    await setUserReadObject(FLOWS_DIR, "s_coexist", "bruce", 500);
    await appendUserInbox(FLOWS_DIR, "s_coexist", "th_2", "msg_2");

    const inbox = await readUserInbox(FLOWS_DIR, "s_coexist");
    expect(inbox.inbox.length).toBe(2);
    expect(inbox.inbox[0]!.messageId).toBe("msg_1");
    expect(inbox.inbox[1]!.messageId).toBe("msg_2");

    const state = await readUserReadState(FLOWS_DIR, "s_coexist");
    expect(state.lastReadTimestampByObject.bruce).toBe(500);

    /* data.json 应同时含两个字段 */
    const raw = JSON.parse(readFileSync(join(FLOWS_DIR, "s_coexist", "user", "data.json"), "utf-8"));
    expect(raw.inbox).toBeInstanceOf(Array);
    expect(raw.readState).toEqual({ lastReadTimestampByObject: { bruce: 500 } });
  });

  test("并发 setUserReadObject 对同 session 串行化不丢数据", async () => {
    const promises: Promise<void>[] = [];
    /* 10 个对象，每个更新 3 次，共 30 次 */
    for (let i = 0; i < 10; i++) {
      for (let j = 1; j <= 3; j++) {
        promises.push(setUserReadObject(FLOWS_DIR, "s_parallel", `obj_${i}`, j * 100));
      }
    }
    await Promise.all(promises);

    const state = await readUserReadState(FLOWS_DIR, "s_parallel");
    for (let i = 0; i < 10; i++) {
      expect(state.lastReadTimestampByObject[`obj_${i}`]).toBe(300);
    }
  });
});

describe("readUserInbox 返回 readState", () => {
  test("合并返回 inbox + readState 字段", async () => {
    await appendUserInbox(FLOWS_DIR, "s_merged", "th_1", "msg_1");
    await setUserReadObject(FLOWS_DIR, "s_merged", "bruce", 123);

    const data = await readUserInbox(FLOWS_DIR, "s_merged");
    expect(data.inbox.length).toBe(1);
    expect(data.readState).toEqual({ lastReadTimestampByObject: { bruce: 123 } });
  });

  test("未初始化 readState 时返回默认空对象", async () => {
    await appendUserInbox(FLOWS_DIR, "s_no_rs", "th_1", "msg_1");
    const data = await readUserInbox(FLOWS_DIR, "s_no_rs");
    expect(data.readState).toEqual({ lastReadTimestampByObject: {} });
  });
});
