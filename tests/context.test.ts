/**
 * Context 构建与格式化测试
 */

import { describe, test, expect } from "bun:test";
import { buildContext } from "../src/context/builder.js";
import { formatContextAsSystem, formatContextAsMessages } from "../src/context/formatter.js";
import { createProcess } from "../src/process/tree.js";
import type { StoneData, FlowData } from "../src/types/index.js";

describe("buildContext", () => {
  test("构建基础 Context", () => {
    const stone: StoneData = {
      name: "researcher",
      thinkable: { whoAmI: "你是一个研究员" },
      talkable: { whoAmI: "研究员", functions: [] },
      data: {},
      relations: [],
      traits: [],
    };

    const flow: FlowData = {
      taskId: "t1",
      stoneName: "researcher",
      status: "running",
      messages: [
        { direction: "in", from: "human", to: "researcher", content: "你好", timestamp: 1 },
      ],
      process: createProcess("task"),
      data: {},
      createdAt: 1,
      updatedAt: 1,
    };

    const directory = [
      { name: "researcher", whoAmI: "研究员", functions: [] },
      { name: "browser", whoAmI: "浏览器", functions: [{ name: "search", description: "搜索" }] },
    ];

    const ctx = buildContext(stone, flow, directory);

    expect(ctx.whoAmI).toBe("你是一个研究员");
    expect(ctx.status).toBe("running");
    expect(ctx.messages).toHaveLength(1);
    /* 通讯录排除自己 */
    expect(ctx.directory).toHaveLength(1);
    expect(ctx.directory[0]!.name).toBe("browser");
  });
});

describe("formatContextAsSystem", () => {
  test("格式化为 system prompt", () => {
    const ctx = {
      name: "researcher",
      whoAmI: "你是一个研究员",
      process: "",
      messages: [],
      actions: [],
      instructions: [{ name: "computable", content: "你可以执行代码" }],
      knowledge: [{ name: "domain_info", content: "领域知识" }],
      directory: [
        { name: "browser", whoAmI: "浏览器", functions: [{ name: "search", description: "搜索" }] },
      ],
      status: "running" as const,
    };

    const text = formatContextAsSystem(ctx);

    expect(text).toContain("WHO AM I");
    expect(text).toContain("研究员");
    expect(text).toContain("INSTRUCTIONS");
    expect(text).toContain("你可以执行代码");
    expect(text).toContain("KNOWLEDGE");
    expect(text).toContain("domain_info");
    expect(text).toContain("DIRECTORY");
    expect(text).toContain("browser");
    expect(text).toContain("search");
    expect(text).toContain("STATUS: running");
  });
});

describe("formatContextAsMessages", () => {
  test("格式化消息为 LLM 对话", () => {
    const ctx = {
      name: "me",
      whoAmI: "",
      process: "",
      messages: [
        { direction: "in" as const, from: "human", to: "me", content: "你好", timestamp: 1 },
        { direction: "out" as const, from: "me", to: "human", content: "你好！", timestamp: 2 },
      ],
      actions: [],
      windows: [],
      directory: [],
      status: "running" as const,
    };

    const msgs = formatContextAsMessages(ctx);
    expect(msgs).toHaveLength(2);
    expect(msgs[0]!.role).toBe("user");
    expect(msgs[1]!.role).toBe("assistant");
  });
});

describe("progressive disclosure", () => {
  test("trait catalog 包含所有非 never trait", () => {
    const stone: StoneData = {
      name: "researcher",
      thinkable: { whoAmI: "研究员" },
      talkable: { whoAmI: "研究员", functions: [] },
      data: {},
      relations: [],
      traits: [],
    };
    const flow: FlowData = {
      taskId: "t1",
      stoneName: "researcher",
      status: "running",
      messages: [],
      process: createProcess("task"),
      data: {},
      createdAt: 1,
      updatedAt: 1,
    };
    const traits = [
      { name: "computable", when: "always" as const, description: "核心 API", readme: "长内容", methods: [], deps: [] },
      { name: "hidden", when: "never" as const, description: "隐藏", readme: "x", methods: [], deps: [] },
      { name: "plannable", when: "条件" as const, description: "规划", readme: "y", methods: [], deps: [] },
    ];
    const ctx = buildContext(stone, flow, [], traits);
    const catalog = ctx.knowledge.find(w => w.name === "_trait_catalog");
    expect(catalog).toBeDefined();
    expect(catalog!.content).toContain("[active] computable: 核心 API");
    expect(catalog!.content).not.toContain("hidden");
    expect(catalog!.content).toContain("plannable: 规划");
  });

  test("无 description 的 trait fallback 到完整注入", () => {
    const stone: StoneData = {
      name: "researcher",
      thinkable: { whoAmI: "研究员" },
      talkable: { whoAmI: "研究员", functions: [] },
      data: {},
      relations: [],
      traits: [],
    };
    const flow: FlowData = {
      taskId: "t1",
      stoneName: "researcher",
      status: "running",
      messages: [],
      process: createProcess("task"),
      data: {},
      createdAt: 1,
      updatedAt: 1,
    };
    const traits = [
      { name: "my_trait", when: "always" as const, description: "", readme: "无 description 应注入", methods: [], deps: [] },
    ];
    const ctx = buildContext(stone, flow, [], traits);
    const noDesc = ctx.knowledge.find(w => w.name === "my_trait");
    expect(noDesc).toBeDefined();
  });
});
