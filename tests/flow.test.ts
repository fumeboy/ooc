/**
 * Flow + ThinkLoop 集成测试
 *
 * 使用 MockLLMClient 验证完整的思考-执行循环。
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { Flow } from "../src/flow/flow.js";
import { runThinkLoop } from "../src/flow/thinkloop.js";
import { MockLLMClient } from "../src/thinkable/client.js";
import type { StoneData } from "../src/types/index.js";
import type { TraitDefinition } from "../src/types/index.js";

const TEST_DIR = join(import.meta.dir, ".tmp_flow_test");

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("Flow", () => {
  test("创建 Flow", () => {
    const flowsDir = join(TEST_DIR, "flows");
    const flow = Flow.create(flowsDir, "researcher", "搜索 AI 安全", "human");

    expect(flow.stoneName).toBe("researcher");
    expect(flow.status).toBe("running");
    expect(flow.messages).toHaveLength(1);
    expect(flow.messages[0]!.content).toBe("搜索 AI 安全");
  });

  test("记录事件", () => {
    const flowsDir = join(TEST_DIR, "flows");
    const flow = Flow.create(flowsDir, "test", "hello", "human");

    flow.recordAction({ type: "thought", content: "我在思考..." });
    expect(flow.actions).toHaveLength(1);
    expect(flow.actions[0]!.type).toBe("thought");
  });

  test("状态转换", () => {
    const flowsDir = join(TEST_DIR, "flows");
    const flow = Flow.create(flowsDir, "test", "hello", "human");

    expect(flow.status).toBe("running");
    flow.setStatus("finished");
    expect(flow.status).toBe("finished");
  });
});

describe("ThinkLoop", () => {
  test("LLM 直接回复（无代码）→ finished", async () => {
    const flowsDir = join(TEST_DIR, "flows");
    const flow = Flow.create(flowsDir, "greeter", "你好", "human");

    const stone: StoneData = {
      name: "greeter",
      thinkable: { whoAmI: "你是一个友好的问候者" },
      talkable: { whoAmI: "问候者", functions: [] },
      data: {},
      relations: [],
      traits: [],
    };

    const llm = new MockLLMClient({
      responses: ["[thought]\n你好！很高兴见到你！\n\n[finish]"],
    });

    await runThinkLoop(flow, stone, TEST_DIR, llm, []);

    expect(flow.status).toBe("finished");
    expect(flow.actions.length).toBeGreaterThanOrEqual(1);
    /* 应该有 thought 事件 */
    const thoughts = flow.actions.filter((a) => a.type === "thought");
    expect(thoughts.length).toBeGreaterThanOrEqual(1);
  });

  test("LLM 输出代码 → 执行 → 继续 → finished", async () => {
    const flowsDir = join(TEST_DIR, "flows2");
    const flow = Flow.create(flowsDir, "calculator", "计算 1+1", "human");

    const stone: StoneData = {
      name: "calculator",
      thinkable: { whoAmI: "你是一个计算器" },
      talkable: { whoAmI: "计算器", functions: [] },
      data: {},
      relations: [],
      traits: [],
    };

    const llm = new MockLLMClient({
      responses: [
        '让我计算一下。\n\n```javascript\nprint(1 + 1);\n```',
        "计算结果是 2。[finish]",
      ],
    });

    await runThinkLoop(flow, stone, TEST_DIR, llm, []);

    expect(flow.status).toBe("finished");
    /* 应该有 thought + program 事件 */
    const thoughts = flow.actions.filter((a) => a.type === "thought");
    const programs = flow.actions.filter((a) => a.type === "program");
    expect(thoughts.length).toBeGreaterThanOrEqual(1);
    expect(programs.length).toBeGreaterThanOrEqual(1);
    /* 程序应该成功执行 */
    expect(programs[0]!.success).toBe(true);
    expect(programs[0]!.result).toContain("2");
  });

  test("[wait] 指令导致 waiting 状态", async () => {
    const flowsDir = join(TEST_DIR, "flows3");
    const flow = Flow.create(flowsDir, "waiter", "等一下", "human");

    const stone: StoneData = {
      name: "waiter",
      thinkable: { whoAmI: "等待者" },
      talkable: { whoAmI: "等待者", functions: [] },
      data: {},
      relations: [],
      traits: [],
    };

    const llm = new MockLLMClient({
      responses: ["我需要更多信息，请提供详细需求。[wait]"],
    });

    await runThinkLoop(flow, stone, TEST_DIR, llm, []);
    expect(flow.status).toBe("waiting");
  });

  test("带 before hook 的 cognize_stack_frame_push 不应被计为空轮", async () => {
    const flowsDir = join(TEST_DIR, "flows4");
    const flow = Flow.create(flowsDir, "supervisor", "分析飞书文档", "human");

    const stone: StoneData = {
      name: "supervisor",
      thinkable: { whoAmI: "你是一个监督者" },
      talkable: { whoAmI: "监督者", functions: [] },
      data: {},
      relations: [],
      traits: [],
    };

    const traits: TraitDefinition[] = [
      {
        namespace: "debug",
        name: "before_hook",
        type: "how_to_think",
        when: "always",
        description: "在压栈前插入 before hook",
        readme: "",
        methods: [],
        deps: [],
        hooks: {
          before: {
            inject: "请先完成 before hook，再继续主任务。",
            once: false,
          },
        },
      },
    ];

    const llm = new MockLLMClient({
      responses: [
        `先创建子栈帧。\n\n[cognize_stack_frame_push]\n\n[cognize_stack_frame_push.title]\n获取文档\n[/cognize_stack_frame_push.title]\n\n[/cognize_stack_frame_push]`,
        "继续思考第 1 轮。",
        "继续思考第 2 轮。",
        "继续思考第 3 轮。",
        "继续思考第 4 轮。",
        `before hook 结束。\n\n[cognize_stack_frame_pop]\n\n[cognize_stack_frame_pop.summary]\nbefore 完成\n[/cognize_stack_frame_pop.summary]\n\n[/cognize_stack_frame_pop]`,
        "主任务已准备好。[finish]",
      ],
    });

    await runThinkLoop(flow, stone, TEST_DIR, llm, [], traits, { maxIterations: 10 });

    expect(flow.status).toBe("finished");
    expect(flow.toJSON().data._pendingStackPush).toBeUndefined();
    expect(flow.process.root.children.some((node) => node.title === "获取文档")).toBe(true);
  });

  test("inline_before 完成后应把已执行的 program 带入真实任务节点", async () => {
    const flowsDir = join(TEST_DIR, "flows5");
    const flow = Flow.create(flowsDir, "supervisor", "获取飞书文档", "human");

    const stone: StoneData = {
      name: "supervisor",
      thinkable: { whoAmI: "你是一个监督者" },
      talkable: { whoAmI: "监督者", functions: [] },
      data: {},
      relations: [],
      traits: [],
    };

    const traits: TraitDefinition[] = [
      {
        namespace: "debug",
        name: "before_hook",
        type: "how_to_think",
        when: "always",
        description: "在压栈前插入 before hook",
        readme: "",
        methods: [],
        deps: [],
        hooks: {
          before: {
            inject: "请先完成 before hook，再继续主任务。",
            once: false,
          },
        },
      },
    ];

    const llm = new MockLLMClient({
      responses: [
        `先创建子栈帧。\n\n[cognize_stack_frame_push]\n\n[cognize_stack_frame_push.title]\n获取文档\n[/cognize_stack_frame_push.title]\n\n[/cognize_stack_frame_push]`,
        `[program]\nprint("doc fetched")\n[/program]\n\n[cognize_stack_frame_pop]\n[/cognize_stack_frame_pop]`,
        `[cognize_stack_frame_pop]\n[cognize_stack_frame_pop.summary]\n获取文档成功\n[/cognize_stack_frame_pop.summary]\n[/cognize_stack_frame_pop]\n[finish]`,
      ],
    });

    await runThinkLoop(flow, stone, TEST_DIR, llm, [], traits, { maxIterations: 6 });

    const taskNode = flow.process.root.children.find((node) => node.title === "获取文档");
    expect(taskNode).toBeDefined();
    expect(taskNode!.actions.some((action) => action.type === "program" && action.result?.includes("doc fetched"))).toBe(true);
  });

  test("仅向 user 发送 talk 时应自动进入 waiting", async () => {
    const flowsDir = join(TEST_DIR, "flows6");
    const flow = Flow.create(flowsDir, "assistant", "回答用户问题", "human");

    const stone: StoneData = {
      name: "assistant",
      thinkable: { whoAmI: "你是一个回答问题的助手" },
      talkable: { whoAmI: "回答助手", functions: [] },
      data: {},
      relations: [],
      traits: [],
    };

    const llm = new MockLLMClient({
      responses: [
        `[thought]\n我已经准备好回复用户。\n\n[talk/user]\n这是答案。\n[/talk]`,
      ],
    });

    const delivered: Array<{ message: string; target: string }> = [];
    const collaboration = {
      talk: (message: string, target: string) => {
        delivered.push({ message, target });
        return `[消息已发送给 ${target}]`;
      },
      talkToSelf: () => "[自我消息已发送]",
      replyToFlow: () => "[已回复 flow]",
    };

    await runThinkLoop(flow, stone, TEST_DIR, llm, [], [], { maxIterations: 5 }, collaboration);

    expect(delivered).toHaveLength(1);
    expect(delivered[0]).toEqual({ message: "这是答案。", target: "user" });
    expect(flow.status).toBe("waiting");
  });
});
