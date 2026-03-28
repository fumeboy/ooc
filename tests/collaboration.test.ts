/**
 * 对象协作（Phase 4）测试
 *
 * 覆盖 Router 协作 API、跨对象 talk、共享文件读写、对话轮次限制
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { join } from "node:path";
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { createCollaborationAPI, type Routable } from "../src/world/router.js";

/** 测试用临时目录 */
const TEST_DIR = join(import.meta.dir, ".tmp-collaboration-test");

/** 清理测试目录 */
function cleanup() {
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true });
  }
}

beforeEach(() => {
  cleanup();
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(cleanup);

/** 模拟 Routable 实现 */
function createMockWorld(objects: Map<string, string>): Routable {
  return {
    deliverMessage: (targetName: string, _message: string, _from: string): void => {
      if (!objects.has(targetName)) {
        throw new Error(`对象 "${targetName}" 不存在`);
      }
      /* fire-and-forget: 消息投递成功，不返回回复 */
    },
    getObjectDir: (name: string): string | null => {
      if (!objects.has(name)) return null;
      return join(TEST_DIR, "stones", name);
    },
  };
}

/* ========== Router / CollaborationAPI 测试 ========== */

describe("createCollaborationAPI", () => {
  test("talk: 跨对象对话成功", () => {
    const objects = new Map([
      ["alice", "AI 助手"],
      ["bob", "研究员"],
    ]);
    const world = createMockWorld(objects);
    const aliceDir = join(TEST_DIR, "stones", "alice");
    mkdirSync(aliceDir, { recursive: true });

    const api = createCollaborationAPI(world, "alice", aliceDir);
    const reply = api.talk("你好！", "bob");

    expect(reply).toContain("消息已发送给 bob");
  });

  test("talk: 目标对象不存在返回错误信息", () => {
    const objects = new Map([["alice", "AI 助手"]]);
    const world = createMockWorld(objects);
    const aliceDir = join(TEST_DIR, "stones", "alice");
    mkdirSync(aliceDir, { recursive: true });

    const api = createCollaborationAPI(world, "alice", aliceDir);
    const reply = api.talk("你好", "nonexistent");

    expect(reply).toContain("[错误]");
  });

  test("talk: 不能向自己发消息", () => {
    const objects = new Map([["alice", "AI 助手"]]);
    const world = createMockWorld(objects);
    const aliceDir = join(TEST_DIR, "stones", "alice");
    mkdirSync(aliceDir, { recursive: true });

    const api = createCollaborationAPI(world, "alice", aliceDir);
    const reply = api.talk("自言自语", "alice");

    expect(reply).toContain("[错误]");
    expect(reply).toContain("自己");
  });

  test("talk: 对话轮次超限返回错误", () => {
    const objects = new Map([
      ["alice", "AI 助手"],
      ["bob", "研究员"],
    ]);
    const world = createMockWorld(objects);
    const aliceDir = join(TEST_DIR, "stones", "alice");
    mkdirSync(aliceDir, { recursive: true });

    const api = createCollaborationAPI(world, "alice", aliceDir);

    /* 连续对话 100 次达到上限 */
    for (let i = 0; i < 100; i++) {
      api.talk(`消息 ${i}`, "bob");
    }

    /* 第 101 次应该被拒绝 */
    const reply = api.talk("超限消息", "bob");
    expect(reply).toContain("[错误]");
    expect(reply).toContain("轮次");
  });

  test("talk: 未超限时正常对话", () => {
    const objects = new Map([
      ["alice", "AI 助手"],
      ["bob", "研究员"],
    ]);
    const world = createMockWorld(objects);
    const aliceDir = join(TEST_DIR, "stones", "alice");
    mkdirSync(aliceDir, { recursive: true });

    const api = createCollaborationAPI(world, "alice", aliceDir);

    /* 连续对话 9 次不超限 */
    for (let i = 0; i < 9; i++) {
      const reply = api.talk(`消息 ${i}`, "bob");
      expect(reply).toContain("消息已发送给 bob");
    }
  });
});
