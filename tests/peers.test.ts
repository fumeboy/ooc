/**
 * Peer 扫描单测（Phase 5）
 *
 * scanPeers(threadData) 扫描当前线程 actions，
 * 聚合 tool_use.args.target + message_in.from + message_out target（不含 self）。
 *
 * 规则：
 * - 去重（Set 语义）
 * - 忽略 self（当前对象）
 * - 忽略保留字 "user" / "system" / "super"（系统通道，不是 peer）——
 *   spec 未明说，但实务上 user/system 不算对象级 peer；super 是自反（不与自己建关系）
 */

import { describe, test, expect } from "bun:test";
import { scanPeers } from "../src/collaborable/relation/peers.js";
import type { ThreadDataFile } from "../src/thinkable/thread-tree/types.js";

function threadData(actions: ThreadDataFile["actions"]): ThreadDataFile {
  return { id: "r", actions };
}

describe("scanPeers — 基础", () => {
  test("tool_use.args.target 进入 peers", () => {
    const td = threadData([
      {
        type: "tool_use",
        name: "submit",
        args: { target: "sophia", msg: "hi", context: "fork" },
        content: "",
        timestamp: 1,
      },
    ]);
    const peers = scanPeers(td, "alice");
    expect(peers).toEqual(["sophia"]);
  });

  test("message_in.from 进入 peers（从 inbox 消息推断）", () => {
    /* message_in 实际上只在 action 流里出现 content 文字；发信方在 inbox 字段 */
    const td: ThreadDataFile = {
      id: "r",
      actions: [],
      inbox: [
        { id: "m1", from: "kernel", content: "update!", timestamp: 1, source: "talk", status: "unread" },
      ],
    };
    const peers = scanPeers(td, "alice");
    expect(peers).toEqual(["kernel"]);
  });

  test("多源去重：同一 peer 只出现一次", () => {
    const td: ThreadDataFile = {
      id: "r",
      actions: [
        {
          type: "tool_use",
          name: "submit",
          args: { target: "sophia", msg: "x", context: "fork" },
          content: "",
          timestamp: 1,
        },
        {
          type: "message_out",
          name: "talk",
          content: "[talk] → sophia: hi",
          timestamp: 2,
        },
      ],
      inbox: [
        { id: "m1", from: "sophia", content: "...", timestamp: 1, source: "talk", status: "unread" },
      ],
    };
    const peers = scanPeers(td, "alice");
    expect(peers).toEqual(["sophia"]);
  });

  test("self 排除", () => {
    const td = threadData([
      {
        type: "tool_use",
        name: "submit",
        args: { target: "alice", msg: "self", context: "fork" },
        content: "",
        timestamp: 1,
      },
    ]);
    const peers = scanPeers(td, "alice");
    expect(peers).toEqual([]);
  });
});

describe("scanPeers — 系统通道过滤", () => {
  test("user / system / super 被过滤", () => {
    const td: ThreadDataFile = {
      id: "r",
      actions: [
        { type: "tool_use", name: "submit", args: { target: "user" }, content: "", timestamp: 1 },
        { type: "tool_use", name: "submit", args: { target: "super" }, content: "", timestamp: 2 },
      ],
      inbox: [
        { id: "m1", from: "system", content: "", timestamp: 1, source: "system", status: "unread" },
        { id: "m2", from: "user", content: "", timestamp: 2, source: "talk", status: "unread" },
      ],
    };
    expect(scanPeers(td, "alice")).toEqual([]);
  });
});

describe("scanPeers — 边界", () => {
  test("空线程返回空", () => {
    expect(scanPeers(threadData([]), "alice")).toEqual([]);
  });

  test("args.target 非字符串被忽略", () => {
    const td = threadData([
      { type: "tool_use", name: "submit", args: { target: 123 as any }, content: "", timestamp: 1 },
    ]);
    expect(scanPeers(td, "alice")).toEqual([]);
  });

  test("大小写不敏感归一（sophia / Sophia 归为同一 peer）", () => {
    const td = threadData([
      { type: "tool_use", name: "submit", args: { target: "Sophia" }, content: "", timestamp: 1 },
      { type: "tool_use", name: "submit", args: { target: "sophia" }, content: "", timestamp: 2 },
    ]);
    /* 保留首次出现大小写 */
    const peers = scanPeers(td, "alice");
    expect(peers.length).toBe(1);
    expect(peers[0]!.toLowerCase()).toBe("sophia");
  });
});
