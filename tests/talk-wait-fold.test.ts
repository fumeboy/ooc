/**
 * talk_sync → talk(wait=true) 折叠验证（flat command-table 版本）
 *
 * 验证：
 * 1. talkable trait 的 activates_on.show_content_when=["talk"] 通过精确匹配涵盖 talk(wait=true)
 *    ——因为 match 总是包含 "talk" 本身
 * 2. talk(wait=true, target≠user) 通过 deriveCommandPaths 产生包含 talk.wait 的路径集合
 * 3. getOpenableCommands() 不包含 "talk_sync"
 * 4. waitingType="talk_sync" 内部标签仍可正常写入（内部状态标签与命令名解耦）
 * 5. 旧复合嵌套路径（talk.wait.fork 等）已消除
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

import { deriveCommandPaths, getOpenableCommands } from "../src/executable/commands/index.js";
import { ThreadsTree } from "../src/thread/tree.js";

const TEST_DIR = join(import.meta.dir, ".tmp_talk_wait_fold_test");

beforeEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("talk(wait=true) 路径推导（多路径并行）", () => {
  test("talk(wait=true) 无 context → 含 talk 和 talk.wait", () => {
    const paths = deriveCommandPaths("talk", { wait: true });
    expect(paths).toContain("talk");
    expect(paths).toContain("talk.wait");
  });

  test("talk(wait=true, context=fork) → 含 talk, talk.wait, talk.fork（不含 talk.wait.fork）", () => {
    const paths = deriveCommandPaths("talk", { wait: true, context: "fork" });
    expect(paths).toContain("talk");
    expect(paths).toContain("talk.wait");
    expect(paths).toContain("talk.fork");
    expect(paths).not.toContain("talk.wait.fork");
  });

  test("talk(wait=true, context=continue) → 含 talk, talk.wait, talk.continue（不含 talk.wait.continue）", () => {
    const paths = deriveCommandPaths("talk", { wait: true, context: "continue" });
    expect(paths).toContain("talk");
    expect(paths).toContain("talk.wait");
    expect(paths).toContain("talk.continue");
    expect(paths).not.toContain("talk.wait.continue");
  });

  test("talk(wait=true, context=continue, type=relation_update) → 不含任何 talk.wait.* 复合嵌套", () => {
    const paths = deriveCommandPaths("talk", { wait: true, context: "continue", type: "relation_update" });
    expect(paths).toContain("talk");
    expect(paths).toContain("talk.wait");
    expect(paths).toContain("talk.continue");
    expect(paths).toContain("talk.continue.relation_update");
    expect(paths).not.toContain("talk.wait.continue");
    expect(paths).not.toContain("talk.wait.continue.relation_update");
  });

  test("talk(wait=false) → 按普通 talk 路径（wait 维度不激活）", () => {
    const paths = deriveCommandPaths("talk", { wait: false, context: "fork" });
    expect(paths).toContain("talk");
    expect(paths).toContain("talk.fork");
    expect(paths).not.toContain("talk.wait");
  });

  test("talk(wait=undefined) → 按普通 talk 路径", () => {
    const paths = deriveCommandPaths("talk", { context: "fork" });
    expect(paths).not.toContain("talk.wait");
    expect(paths).toContain("talk.fork");
  });
});

describe("精确匹配：talkable 绑定 talk 可覆盖所有 talk.* 变体", () => {
  test("binding=talk 精确命中 talk（在 match 结果中）", () => {
    /* match 总是包含 bare name "talk"，因此 trait 声明 ["talk"] 精确命中 */
    const paths = deriveCommandPaths("talk", { wait: true });
    expect(paths).toContain("talk");
  });

  test("talk(wait=true, context=fork) match 结果中同时含 talk 和 talk.fork", () => {
    const paths = deriveCommandPaths("talk", { wait: true, context: "fork" });
    expect(paths).toContain("talk");
    expect(paths).toContain("talk.fork");
  });

  test("talk(wait=true, context=continue, type=relation_update) match 含 talk.continue.relation_update", () => {
    const paths = deriveCommandPaths("talk", { wait: true, context: "continue", type: "relation_update" });
    expect(paths).toContain("talk.continue.relation_update");
  });

  test("talk.fork 不在 talk(context=continue) 的 match 结果中（独立维度）", () => {
    const paths = deriveCommandPaths("talk", { context: "continue" });
    expect(paths).not.toContain("talk.fork");
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
