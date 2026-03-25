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
      responses: ["你好！很高兴见到你！"],
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
});
