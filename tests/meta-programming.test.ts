/**
 * 元编程系统集成测试
 *
 * 覆盖 Trait 读取/列表/激活、Context Window CRUD、动态 Window 解析。
 * 使用 MockLLMClient 通过 ThinkLoop 沙箱 API 验证。
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Flow } from "../src/flow/flow.js";
import { runThinkLoop } from "../src/flow/thinkloop.js";
import { MockLLMClient } from "../src/thinkable/client.js";
import { buildContext } from "../src/context/builder.js";
import { createProcess } from "../src/process/tree.js";
import type { StoneData, FlowData } from "../src/types/index.js";

const TEST_ROOT = join(import.meta.dir, ".tmp_meta_test");
const TEST_DIR = join(TEST_ROOT, "stones", "tester");

const makeStone = (name = "tester"): StoneData => ({
  name,
  thinkable: { whoAmI: "测试对象" },
  talkable: { whoAmI: "测试", functions: [] },
  data: {},
  relations: [],
  traits: [],
});

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
  mkdirSync(join(TEST_DIR, "traits"), { recursive: true });
});

afterEach(() => {
  rmSync(TEST_ROOT, { recursive: true, force: true });
});

/* ========== Trait 读取/列表/激活 ========== */

describe("Trait API（通过 ThinkLoop 沙箱）", () => {
  test("readTrait 返回完整信息", async () => {
    /* 先手动创建一个 trait */
    const traitDir = join(TEST_DIR, "traits", "existing");
    mkdirSync(traitDir, { recursive: true });
    writeFileSync(join(traitDir, "readme.md"), "---\nwhen: always\n---\n\n# 已有技能", "utf-8");
    writeFileSync(join(traitDir, "index.ts"), "export function hello(ctx) { ctx.print('hi'); }", "utf-8");

    const flowsDir = join(TEST_DIR, "flows");
    const flow = Flow.create(flowsDir, "tester", "读取 trait", "human");
    const stone = makeStone();

    const llm = new MockLLMClient({
      responses: [
        '```javascript\nconst info = readTrait("existing");\nprint(JSON.stringify(info));\n```',
        "[finish]",
      ],
    });

    await runThinkLoop(flow, stone, TEST_DIR, llm, []);

    /* 验证 program 输出包含 trait 信息 */
    const programs = flow.actions.filter((a) => a.type === "program");
    expect(programs.length).toBeGreaterThanOrEqual(1);
    expect(programs[0]!.result).toContain("existing");
    expect(programs[0]!.result).toContain("always");
  });

  test("listTraits 列出所有 trait", async () => {
    mkdirSync(join(TEST_DIR, "traits", "alpha"), { recursive: true });
    mkdirSync(join(TEST_DIR, "traits", "beta"), { recursive: true });

    const flowsDir = join(TEST_DIR, "flows");
    const flow = Flow.create(flowsDir, "tester", "列出 traits", "human");
    const stone = makeStone();

    const llm = new MockLLMClient({
      responses: [
        '```javascript\nconst list = listTraits();\nprint(JSON.stringify(list));\n```',
        "[finish]",
      ],
    });

    await runThinkLoop(flow, stone, TEST_DIR, llm, []);

    const programs = flow.actions.filter((a) => a.type === "program");
    expect(programs[0]!.result).toContain("alpha");
    expect(programs[0]!.result).toContain("beta");
  });

  test("activateTrait 校验 trait 是否存在", async () => {
    const flowsDir = join(TEST_DIR, "flows");
    const flow = Flow.create(flowsDir, "tester", "激活不存在的 trait", "human");
    const stone = makeStone();

    const llm = new MockLLMClient({
      responses: [
        '```javascript\nconst r = activateTrait("nonexistent_trait");\nprint(r);\n```',
        "[finish]",
      ],
    });

    await runThinkLoop(flow, stone, TEST_DIR, llm, []);

    const programs = flow.actions.filter((a) => a.type === "program");
    expect(programs[0]!.result).toContain("不存在");
  });

  test("readTrait 对不存在的 trait 返回错误消息", async () => {
    const flowsDir = join(TEST_DIR, "flows");
    const flow = Flow.create(flowsDir, "tester", "读取不存在", "human");
    const stone = makeStone();

    const llm = new MockLLMClient({
      responses: [
        '```javascript\nconst r = readTrait("ghost");\nprint(r);\n```',
        "[finish]",
      ],
    });

    await runThinkLoop(flow, stone, TEST_DIR, llm, []);

    const programs = flow.actions.filter((a) => a.type === "program");
    expect(programs[0]!.result).toContain("不存在");
  });

  test("readTrait 返回剥离 frontmatter 的 readme", async () => {
    const traitDir = join(TEST_DIR, "traits", "clean_read");
    mkdirSync(traitDir, { recursive: true });
    writeFileSync(join(traitDir, "readme.md"), '---\nwhen: "always"\n---\n\n# 干净内容', "utf-8");

    const flowsDir = join(TEST_DIR, "flows");
    const flow = Flow.create(flowsDir, "tester", "读取干净", "human");
    const stone = makeStone();

    const llm = new MockLLMClient({
      responses: [
        '```javascript\nconst r = readTrait("clean_read");\nprint(JSON.stringify(r));\n```',
        "[finish]",
      ],
    });

    await runThinkLoop(flow, stone, TEST_DIR, llm, []);

    const programs = flow.actions.filter((a) => a.type === "program");
    /* readme 不应包含 frontmatter */
    expect(programs[0]!.result).toContain("# 干净内容");
    expect(programs[0]!.result).not.toContain("---");
  });
});

/* ========== SelfMeta Flow ========== */

describe("ReflectFlow", () => {
  test("Flow.ensureReflectFlow 创建 _reflect Flow", () => {
    const reflectDir = join(TEST_DIR, "reflect");
    mkdirSync(reflectDir, { recursive: true });

    const selfMeta = Flow.ensureReflectFlow(reflectDir, "tester");
    expect(selfMeta.taskId).toBe("_reflect");
    expect(selfMeta.isSelfMeta).toBe(true);
    expect(selfMeta.status).toBe("waiting");

    /* 再次调用应返回同一个（幂等） */
    const selfMeta2 = Flow.ensureReflectFlow(reflectDir, "tester");
    expect(selfMeta2.taskId).toBe("_reflect");
  });

  test("普通 Flow 的 isSelfMeta 为 false", () => {
    const flowsDir = join(TEST_DIR, "flows");
    const flow = Flow.create(flowsDir, "tester", "普通任务", "human");
    expect(flow.isSelfMeta).toBe(false);
  });
});

/* ========== Context Window CRUD ========== */

describe("Context Window CRUD（通过 ThinkLoop 沙箱）", () => {
  test("addWindow 静态文本 + listWindows", async () => {
    const flowsDir = join(TEST_DIR, "flows");
    const flow = Flow.create(flowsDir, "tester", "添加窗口", "human");
    const stone = makeStone();

    const llm = new MockLLMClient({
      responses: [
        '```javascript\naddWindow("参考", "重要信息");\nconst list = listWindows();\nprint(JSON.stringify(list));\n```',
        "[finish]",
      ],
    });

    await runThinkLoop(flow, stone, TEST_DIR, llm, []);

    const programs = flow.actions.filter((a) => a.type === "program");
    expect(programs[0]!.result).toContain("参考");

    /* 验证 flow data 中存储了 window 配置 */
    const flowData = flow.toJSON();
    const windows = flowData.data._windows as Record<string, unknown>;
    expect(windows).toBeDefined();
    expect(windows["参考"]).toBeDefined();
  });

  test("addWindow 文件型", async () => {
    /* 创建一个文件供 window 引用 */
    writeFileSync(join(TEST_DIR, "notes.txt"), "笔记内容", "utf-8");

    const flowsDir = join(TEST_DIR, "flows");
    const flow = Flow.create(flowsDir, "tester", "文件窗口", "human");
    const stone = makeStone();

    const llm = new MockLLMClient({
      responses: [
        '```javascript\naddWindow("笔记", { file: "notes.txt" });\nconst content = getWindow("笔记");\nprint(content);\n```',
        "[finish]",
      ],
    });

    await runThinkLoop(flow, stone, TEST_DIR, llm, []);

    const programs = flow.actions.filter((a) => a.type === "program");
    expect(programs[0]!.result).toContain("笔记内容");
  });

  test("addWindow 函数型", async () => {
    const flowsDir = join(TEST_DIR, "flows");
    const flow = Flow.create(flowsDir, "tester", "函数窗口", "human");
    const stone = makeStone();

    const llm = new MockLLMClient({
      responses: [
        '```javascript\naddWindow("新闻", { trait: "news", method: "getLatest" });\nconst info = getWindow("新闻");\nprint(info);\n```',
        "[finish]",
      ],
    });

    await runThinkLoop(flow, stone, TEST_DIR, llm, []);

    const programs = flow.actions.filter((a) => a.type === "program");
    expect(programs[0]!.result).toContain("函数型 window");
    expect(programs[0]!.result).toContain("news.getLatest");
  });

  test("editWindow + removeWindow", async () => {
    const flowsDir = join(TEST_DIR, "flows");
    const flow = Flow.create(flowsDir, "tester", "编辑窗口", "human");
    const stone = makeStone();

    const llm = new MockLLMClient({
      responses: [
        [
          "```javascript",
          'addWindow("temp", "初始内容");',
          'editWindow("temp", "更新内容");',
          'const c = getWindow("temp");',
          'print("after edit:", c);',
          'removeWindow("temp");',
          'const list = listWindows();',
          'print("after remove:", JSON.stringify(list));',
          "```",
        ].join("\n"),
        "[finish]",
      ],
    });

    await runThinkLoop(flow, stone, TEST_DIR, llm, []);

    const programs = flow.actions.filter((a) => a.type === "program");
    expect(programs[0]!.result).toContain("更新内容");
    expect(programs[0]!.result).toContain("after remove: []");
  });
});

/* ========== Context Builder 动态 Window 解析 ========== */

describe("buildContext 动态 Window 解析", () => {
  test("解析静态 window", () => {
    const flowData: FlowData = {
      taskId: "t1",
      stoneName: "tester",
      status: "running",
      messages: [],
      process: createProcess("task"),
      data: {
        _windows: {
          "参考": { name: "参考", type: "static", content: "静态内容" },
        },
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const ctx = buildContext(makeStone(), flowData, []);
    const win = ctx.knowledge.find((w) => w.name === "参考");
    expect(win).toBeDefined();
    expect(win!.content).toBe("静态内容");
  });

  test("解析文件型 window", () => {
    /* 创建文件 */
    writeFileSync(join(TEST_DIR, "data.txt"), "文件数据", "utf-8");

    const flowData: FlowData = {
      taskId: "t2",
      stoneName: "tester",
      status: "running",
      messages: [],
      process: createProcess("task"),
      data: {
        _windows: {
          "数据": { name: "数据", type: "file", filePath: "data.txt" },
        },
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const ctx = buildContext(makeStone(), flowData, [], [], [], TEST_DIR);
    const win = ctx.knowledge.find((w) => w.name === "数据");
    expect(win).toBeDefined();
    expect(win!.content).toBe("文件数据");
  });

  test("解析函数型 window（占位符）", () => {
    const flowData: FlowData = {
      taskId: "t3",
      stoneName: "tester",
      status: "running",
      messages: [],
      process: createProcess("task"),
      data: {
        _windows: {
          "新闻": { name: "新闻", type: "function", traitName: "news", methodName: "getLatest" },
        },
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const ctx = buildContext(makeStone(), flowData, []);
    const win = ctx.knowledge.find((w) => w.name === "新闻");
    expect(win).toBeDefined();
    expect(win!.content).toContain("news.getLatest");
  });

  test("无 _windows 时返回空", () => {
    const flowData: FlowData = {
      taskId: "t4",
      stoneName: "tester",
      status: "running",
      messages: [],
      process: createProcess("task"),
      data: {},
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const ctx = buildContext(makeStone(), flowData, []);
    /* 只有 trait catalog（无 user trait windows 也无 dynamic windows） */
    expect(ctx.knowledge).toHaveLength(1);
    expect(ctx.knowledge[0]!.name).toBe("_trait_catalog");
  });
});
