/**
 * talk_sync → talk(wait=true) 折叠验证
 *
 * 验证：
 * 1. talkable trait 的 activates_on.paths 通过前缀匹配涵盖 talk(wait=true)（路径 talk.wait.*）
 * 2. talk(wait=true, target≠user) 通过 deriveCommandPath 产生 talk.wait.* 路径
 * 3. getOpenableCommands() 不包含 "talk_sync"
 * 4. waitingType="talk_sync" 内部标签仍可正常写入（内部状态标签与命令名解耦）
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

import { deriveCommandPath, getOpenableCommands, matchesCommandPath } from "../src/thread/command-tree.js";
import { ThreadsTree } from "../src/thread/tree.js";

const TEST_DIR = join(import.meta.dir, ".tmp_talk_wait_fold_test");

beforeEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("talk(wait=true) 路径推导", () => {
  test("talk(wait=true) 无 context → talk.wait", () => {
    expect(deriveCommandPath("talk", { wait: true })).toBe("talk.wait");
  });

  test("talk(wait=true, context=fork) → talk.wait.fork", () => {
    expect(deriveCommandPath("talk", { wait: true, context: "fork" })).toBe("talk.wait.fork");
  });

  test("talk(wait=true, context=continue) → talk.wait.continue", () => {
    expect(deriveCommandPath("talk", { wait: true, context: "continue" })).toBe("talk.wait.continue");
  });

  test("talk(wait=true, context=continue, type=relation_update) → talk.wait.continue.relation_update", () => {
    expect(deriveCommandPath("talk", { wait: true, context: "continue", type: "relation_update" })).toBe("talk.wait.continue.relation_update");
  });

  test("talk(wait=false) → 按普通 talk 路径（wait 维度不激活）", () => {
    expect(deriveCommandPath("talk", { wait: false, context: "fork" })).toBe("talk.fork");
  });

  test("talk(wait=undefined) → 按普通 talk 路径", () => {
    expect(deriveCommandPath("talk", { context: "fork" })).toBe("talk.fork");
  });
});

describe("前缀匹配：talkable 绑定 talk 可覆盖 talk.wait.*", () => {
  test("binding=talk 命中 talk.wait", () => {
    expect(matchesCommandPath("talk.wait", "talk")).toBe(true);
  });

  test("binding=talk 命中 talk.wait.fork", () => {
    expect(matchesCommandPath("talk.wait.fork", "talk")).toBe(true);
  });

  test("binding=talk 命中 talk.wait.continue.relation_update", () => {
    expect(matchesCommandPath("talk.wait.continue.relation_update", "talk")).toBe(true);
  });

  test("binding=talk.fork 不命中 talk.wait.fork（不同维度的兄弟节点）", () => {
    /* talk.wait.fork 不以 talk.fork. 开头 */
    expect(matchesCommandPath("talk.wait.fork", "talk.fork")).toBe(false);
  });

  test("binding=talk.wait.fork 精确命中 talk.wait.fork", () => {
    expect(matchesCommandPath("talk.wait.fork", "talk.wait.fork")).toBe(true);
  });
});

describe("getOpenableCommands() 不含 talk_sync", () => {
  test("结果中不包含 talk_sync", () => {
    const cmds = getOpenableCommands();
    expect(cmds).not.toContain("talk_sync");
  });

  test("结果中包含 talk", () => {
    const cmds = getOpenableCommands();
    expect(cmds).toContain("talk");
  });
});

describe("waitingType='talk_sync' 内部标签仍可写入（与命令名解耦）", () => {
  test("setNodeStatus('waiting', 'talk_sync') 写入内部等待状态", async () => {
    const tree = await ThreadsTree.create(TEST_DIR, "test-wt");
    const rootId = tree.rootId;
    const childId = await tree.createSubThread(rootId, "test-child");
    const nodeId = childId ?? rootId;

    await tree.setNodeStatus(nodeId, "waiting", "talk_sync");
    const node = tree.getNode(nodeId);
    expect(node?.status).toBe("waiting");
    expect(node?.waitingType).toBe("talk_sync");
  });
});
