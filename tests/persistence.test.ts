/**
 * 持久化层测试
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { readStone, writeStone, readFlow, writeFlow, listObjects } from "../src/persistence/index.js";
import { createProcess } from "../src/persistence/process-compat.js";
import type { StoneData, FlowData } from "../src/types/index.js";

const TEST_DIR = join(import.meta.dir, ".tmp_persistence_test");

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("readStone / writeStone", () => {
  test("写入并读取 Stone", () => {
    const dir = join(TEST_DIR, "objects", "researcher");
    const stone: StoneData = {
      name: "researcher",
      thinkable: { whoAmI: "你是一个研究员" },
      talkable: {
        whoAmI: "研究员",
        functions: [{ name: "search", description: "搜索信息" }],
      },
      data: { topic: "AI safety" },
      relations: [{ name: "browser", description: "搜索工具" }],
      traits: [],
    };

    writeStone(dir, stone);
    expect(existsSync(join(dir, "readme.md"))).toBe(true);
    expect(existsSync(join(dir, "data.json"))).toBe(true);
    expect(existsSync(join(dir, "traits"))).toBe(true);
    expect(existsSync(join(dir, "reflect"))).toBe(true);

    const loaded = readStone(dir);
    expect(loaded).not.toBeNull();
    expect(loaded!.name).toBe("researcher");
    expect(loaded!.thinkable.whoAmI).toContain("研究员");
    expect(loaded!.talkable.whoAmI).toBe("研究员");
    expect(loaded!.talkable.functions).toHaveLength(1);
    expect(loaded!.data.topic).toBe("AI safety");
    expect(loaded!.relations).toHaveLength(1);
    expect(loaded!.relations[0]!.name).toBe("browser");
  });

  test("读取不存在的目录返回 null", () => {
    const result = readStone(join(TEST_DIR, "nonexistent"));
    expect(result).toBeNull();
  });
});

describe("readFlow / writeFlow", () => {
  test("写入并读取 Flow", () => {
    const dir = join(TEST_DIR, "flows", "session_001");
    const flow: FlowData = {
      sessionId: "session_001",
      stoneName: "researcher",
      status: "running",
      messages: [
        {
          direction: "in",
          from: "human",
          to: "researcher",
          content: "搜索 AI 安全",
          timestamp: Date.now(),
        },
      ],
      process: createProcess("task"),
      data: {},
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    writeFlow(dir, flow);
    expect(existsSync(join(dir, "data.json"))).toBe(true);
    expect(existsSync(join(dir, "process.json"))).toBe(true);
    expect(existsSync(join(dir, "files"))).toBe(true);

    const loaded = readFlow(dir);
    expect(loaded).not.toBeNull();
    expect(loaded!.sessionId).toBe("session_001");
    expect(loaded!.status).toBe("running");
    expect(loaded!.messages).toHaveLength(1);
  });
});

describe("process.json 分离", () => {
  test("process 写入独立 process.json", () => {
    const dir = join(TEST_DIR, "flows", "session_process");
    const flow: FlowData = {
      sessionId: "session_process",
      stoneName: "researcher",
      status: "running",
      messages: [],
      process: {
        root: {
          id: "root_1",
          title: "研究计划",
          status: "doing",
          children: [],
          actions: [],
        },
        focusId: "root_1",
      },
      data: {},
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    writeFlow(dir, flow);

    /* process.json 应该存在 */
    expect(existsSync(join(dir, "process.json"))).toBe(true);

    /* data.json 不应包含 process 字段 */
    const dataJson = JSON.parse(readFileSync(join(dir, "data.json"), "utf-8"));
    expect(dataJson.process).toBeUndefined();
    expect(dataJson.sessionId).toBe("session_process");

    /* process.json 包含行为树 */
    const processJson = JSON.parse(readFileSync(join(dir, "process.json"), "utf-8"));
    expect(processJson.root.title).toBe("研究计划");
    expect(processJson.focusId).toBe("root_1");
  });

  test("readFlow 自动合并 process.json", () => {
    const dir = join(TEST_DIR, "flows", "session_merge");
    const flow: FlowData = {
      sessionId: "session_merge",
      stoneName: "researcher",
      status: "finished",
      messages: [],
      process: {
        root: {
          id: "root_2",
          title: "分析任务",
          status: "done",
          children: [],
          actions: [],
          summary: "分析完成",
        },
        focusId: "root_2",
      },
      data: {},
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    writeFlow(dir, flow);
    const loaded = readFlow(dir);

    expect(loaded).not.toBeNull();
    expect(loaded!.sessionId).toBe("session_merge");
    expect(loaded!.process).toBeDefined();
    expect(loaded!.process.root.title).toBe("分析任务");
    expect(loaded!.process.focusId).toBe("root_2");
  });

  test("旧版数据无 process.json 时自动创建默认 process", () => {
    const dir = join(TEST_DIR, "flows", "session_legacy");
    mkdirSync(dir, { recursive: true });

    /* 模拟旧版数据：只有 data.json，无 process.json */
    writeFileSync(join(dir, "data.json"), JSON.stringify({
      sessionId: "session_legacy",
      stoneName: "researcher",
      status: "finished",
      messages: [],
      actions: [],
      data: {},
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }, null, 2), "utf-8");

    const loaded = readFlow(dir);
    expect(loaded).not.toBeNull();
    expect(loaded!.process).toBeDefined();
    expect(loaded!.process.root).toBeDefined();
    expect(loaded!.process.focusId).toBe(loaded!.process.root.id);
  });
});

describe("listObjects", () => {
  test("列出所有对象", () => {
    const objectsDir = join(TEST_DIR, "objects");
    mkdirSync(join(objectsDir, "alpha"), { recursive: true });
    mkdirSync(join(objectsDir, "beta"), { recursive: true });

    const names = listObjects(objectsDir);
    expect(names).toContain("alpha");
    expect(names).toContain("beta");
    expect(names).toHaveLength(2);
  });

  test("空目录返回空列表", () => {
    const names = listObjects(join(TEST_DIR, "empty"));
    expect(names).toHaveLength(0);
  });
});
