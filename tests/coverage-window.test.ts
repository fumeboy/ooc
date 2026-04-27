/**
 * Coverage window 注入测试
 *
 * 覆盖：
 * - runTests(--coverage) 后 getLatestCoverage 返回最近快照
 * - context-builder 注入 <knowledge name="coverage"> 窗口
 * - 无 coverage 时不注入
 */

import { describe, test, expect, beforeEach } from "bun:test";
import { buildThreadContext } from "../src/thinkable/context/builder";
import {
  clearLatestCoverage,
  getLatestCoverage,
  __emitFailuresForTest,
} from "../src/observable/test-runner/runner";
import type { ThreadsTreeFile, ThreadDataFile } from "../src/thread/types";
import type { StoneData } from "../src/types/index";

function makeMinimalTree(): ThreadsTreeFile {
  return {
    version: "2",
    rootId: "root",
    nodes: {
      root: {
        id: "root",
        parentId: null,
        childrenIds: [],
        title: "root",
        status: "active",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    },
  } as unknown as ThreadsTreeFile;
}

function makeMinimalData(): ThreadDataFile {
  return {
    threadId: "root",
    actions: [],
  } as unknown as ThreadDataFile;
}

function makeStone(): StoneData {
  return {
    name: "tester",
    data: {},
    thinkable: { whoAmI: "test object" },
  } as unknown as StoneData;
}

beforeEach(() => {
  clearLatestCoverage();
});

describe("Coverage window", () => {
  test("无 coverage 时不注入 coverage 窗口", () => {
    const ctx = buildThreadContext({
      tree: makeMinimalTree(),
      threadId: "root",
      threadData: makeMinimalData(),
      stone: makeStone(),
      directory: [],
      traits: [],
    });
    const has = ctx.knowledge.some((w) => w.name === "coverage");
    expect(has).toBe(false);
  });

  test("getLatestCoverage 返回 undefined 时不注入", () => {
    /* 直接调 getter 应为 undefined */
    expect(getLatestCoverage()).toBe(undefined);
  });

  test("注入 coverage 窗口 —— 手动喂缓存", async () => {
    /* 绕过 runTests 直接喂数据，避免依赖 bun test 子进程 */
    const { __injectLatestCoverageForTest } = await import("../src/observable/test-runner/runner");
    __injectLatestCoverageForTest({
      cwd: "/tmp/r",
      pct: 72.5,
      summary: "src/foo.ts |  40.0 |\nsrc/bar.ts |  60.0 |",
      updatedAt: Date.now(),
    });
    const ctx = buildThreadContext({
      tree: makeMinimalTree(),
      threadId: "root",
      threadData: makeMinimalData(),
      stone: makeStone(),
      directory: [],
      traits: [],
    });
    const cov = ctx.knowledge.find((w) => w.name === "coverage");
    expect(cov).toBeDefined();
    expect(cov!.content).toContain("72.5");
    expect(cov!.content).toContain("src/foo.ts");
  });
});
