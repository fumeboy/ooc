import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

import { runWithThreadTree, type EngineConfig } from "../src/thinkable/engine/engine.js";
import { MockLLMClient, type ToolCall } from "../src/thinkable/llm/client.js";
import type { StoneData } from "../src/shared/types/index.js";
import { eventBus } from "../src/observable/server/events.js";
import type { ProcessEvent } from "../src/thinkable/thread-tree/types.js";

const TEST_DIR = join(import.meta.dir, ".tmp_submit_empty_fallback_test");
const FLOWS_DIR = join(TEST_DIR, "flows");

function makeStone(name: string): StoneData {
  return {
    name,
    thinkable: { whoAmI: `${name}` },
    talkable: { whoAmI: `${name}`, functions: [] },
    data: {},
    relations: [],
    traits: [],
  };
}

function toolCall(name: string, args: Record<string, unknown>): ToolCall {
  return {
    id: `tc_${Math.random().toString(36).slice(2, 8)}`,
    type: "function",
    function: { name, arguments: JSON.stringify(args) },
  };
}

async function readRootActions(sessionId: string): Promise<ProcessEvent[]> {
  const objectDir = join(FLOWS_DIR, sessionId, "objects", "alice");
  const threadsJson = JSON.parse(await Bun.file(join(objectDir, "threads.json")).text());
  const rootId = threadsJson.rootId as string;
  const thread = JSON.parse(await Bun.file(join(objectDir, "threads", rootId, "thread.json")).text());
  return (thread.events) as ProcessEvent[];
}

beforeEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
  mkdirSync(FLOWS_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
  eventBus.removeAllListeners("sse");
});

describe("submit({}) fallback", () => {
  test("单个 active form 时，空 submit 使用该 form，不产生 Form undefined 错误", async () => {
    let step = 0;
    let returnFormId = "f_unknown";
    const llm = new MockLLMClient({
      responseFn: (messages) => {
        step++;
        const allContent = (messages as Array<{ role: string; content: string }>).map((m) => m.content).join("\n");
        if (step === 1) {
          return {
            content: "",
            toolCalls: [toolCall("open", {
              title: "准备返回",
              type: "command",
              command: "return",
              description: "结束任务",
            })],
          };
        }
        if (step === 2) {
          const m = allContent.match(/<form id="(f_[^"]+)" command="return"/);
          if (m?.[1]) returnFormId = m[1];
          return {
            content: "",
            toolCalls: [toolCall("refine", {
              title: "填写返回摘要",
              form_id: returnFormId,
              args: { summary: "done through empty submit" },
            })],
          };
        }
        return {
          content: "",
          toolCalls: [toolCall("submit", {})],
        };
      },
    });

    const config: EngineConfig = {
      rootDir: TEST_DIR,
      flowsDir: FLOWS_DIR,
      llm,
      directory: [],
      traits: [],
      stone: makeStone("alice"),
      schedulerConfig: {
        maxIterationsPerThread: 10,
        maxTotalIterations: 20,
        deadlockGracePeriodMs: 0,
      },
    };

    const result = await runWithThreadTree("alice", "test", "user", config);

    expect(result.status).toBe("done");
    expect(result.summary).toBe("done through empty submit");
    const actions = await readRootActions(result.sessionId);
    expect(actions.some((a) => a.type === "inject" && a.content.includes("Form undefined"))).toBe(false);
  });

  test("单个 active form 时，refine 缺 form_id 也使用该 form", async () => {
    let step = 0;
    const llm = new MockLLMClient({
      responseFn: () => {
        step++;
        if (step === 1) {
          return {
            content: "",
            toolCalls: [toolCall("open", {
              title: "准备返回",
              type: "command",
              command: "return",
              description: "结束任务",
            })],
          };
        }
        if (step === 2) {
          return {
            content: "",
            toolCalls: [toolCall("refine", {
              title: "填写返回摘要",
              args: { summary: "done through empty refine" },
            })],
          };
        }
        return {
          content: "",
          toolCalls: [toolCall("submit", {})],
        };
      },
    });

    const config: EngineConfig = {
      rootDir: TEST_DIR,
      flowsDir: FLOWS_DIR,
      llm,
      directory: [],
      traits: [],
      stone: makeStone("alice"),
      schedulerConfig: {
        maxIterationsPerThread: 10,
        maxTotalIterations: 20,
        deadlockGracePeriodMs: 0,
      },
    };

    const result = await runWithThreadTree("alice", "test", "user", config);

    expect(result.status).toBe("done");
    expect(result.summary).toBe("done through empty refine");
    const actions = await readRootActions(result.sessionId);
    expect(actions.some((a) => a.type === "inject" && a.content.includes("refine 失败：Form  不存在"))).toBe(false);
  });

  test("refine({}) 不应被当作成功累积", async () => {
    let step = 0;
    const llm = new MockLLMClient({
      responseFn: () => {
        step++;
        if (step === 1) {
          return {
            content: "",
            toolCalls: [toolCall("open", {
              title: "准备返回",
              type: "command",
              command: "return",
              description: "结束任务",
            })],
          };
        }
        if (step === 2) {
          return {
            content: "",
            toolCalls: [toolCall("refine", {})],
          };
        }
        return {
          content: "",
          toolCalls: [toolCall("wait", {
            title: "等待人工修正",
            reason: "empty refine observed",
          })],
        };
      },
    });

    const config: EngineConfig = {
      rootDir: TEST_DIR,
      flowsDir: FLOWS_DIR,
      llm,
      directory: [],
      traits: [],
      stone: makeStone("alice"),
      schedulerConfig: {
        maxIterationsPerThread: 4,
        maxTotalIterations: 8,
        deadlockGracePeriodMs: 0,
      },
    };

    const result = await runWithThreadTree("alice", "test", "user", config);

    const actions = await readRootActions(result.sessionId);
    expect(actions.some((a) => a.type === "inject" && a.content.includes("refine 参数不完整"))).toBe(true);
    expect(actions.some((a) => a.type === "inject" && a.content.includes("[refine] Form") && a.content.includes("已累积参数"))).toBe(false);
  });

  test("open({}) 会给出明确参数错误，避免静默空转", async () => {
    let step = 0;
    const llm = new MockLLMClient({
      responseFn: () => {
        step++;
        if (step === 1) {
          return {
            content: "",
            toolCalls: [toolCall("open", {})],
          };
        }
        return {
          content: "",
          toolCalls: [toolCall("wait", {
            title: "等待人工修正",
            reason: "invalid open observed",
          })],
        };
      },
    });

    const config: EngineConfig = {
      rootDir: TEST_DIR,
      flowsDir: FLOWS_DIR,
      llm,
      directory: [],
      traits: [],
      stone: makeStone("alice"),
      schedulerConfig: {
        maxIterationsPerThread: 3,
        maxTotalIterations: 6,
        deadlockGracePeriodMs: 0,
      },
    };

    const result = await runWithThreadTree("alice", "test", "user", config);

    const actions = await readRootActions(result.sessionId);
    expect(actions.some((a) => a.type === "inject" && a.content.includes("open 参数不完整"))).toBe(true);
  });

  test("连续 open({}) 会升级纠偏提示", async () => {
    let step = 0;
    const llm = new MockLLMClient({
      responseFn: () => {
        step++;
        if (step <= 2) {
          return {
            content: "",
            toolCalls: [toolCall("open", {})],
          };
        }
        return {
          content: "",
          toolCalls: [toolCall("wait", {
            title: "等待人工修正",
            reason: "repeated invalid open observed",
          })],
        };
      },
    });

    const config: EngineConfig = {
      rootDir: TEST_DIR,
      flowsDir: FLOWS_DIR,
      llm,
      directory: [],
      traits: [],
      stone: makeStone("alice"),
      schedulerConfig: {
        maxIterationsPerThread: 4,
        maxTotalIterations: 8,
        deadlockGracePeriodMs: 0,
      },
    };

    const result = await runWithThreadTree("alice", "test", "user", config);

    const actions = await readRootActions(result.sessionId);
    expect(actions.some((a) => a.type === "inject" && a.content.includes("连续协议错误"))).toBe(true);
  });

  test("没有 active form 时 close({}) 会给出明确错误", async () => {
    let step = 0;
    const llm = new MockLLMClient({
      responseFn: () => {
        step++;
        if (step === 1) {
          return {
            content: "",
            toolCalls: [toolCall("close", {})],
          };
        }
        return {
          content: "",
          toolCalls: [toolCall("wait", {
            title: "等待人工修正",
            reason: "invalid close observed",
          })],
        };
      },
    });

    const config: EngineConfig = {
      rootDir: TEST_DIR,
      flowsDir: FLOWS_DIR,
      llm,
      directory: [],
      traits: [],
      stone: makeStone("alice"),
      schedulerConfig: {
        maxIterationsPerThread: 3,
        maxTotalIterations: 6,
        deadlockGracePeriodMs: 0,
      },
    };

    const result = await runWithThreadTree("alice", "test", "user", config);

    const actions = await readRootActions(result.sessionId);
    expect(actions.some((a) => a.type === "inject" && a.content.includes("close 参数不完整"))).toBe(true);
  });
});
