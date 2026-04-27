/**
 * Tool-call title 参数单元测试
 *
 * 验证阶段 B 的三个契约：
 * 1. tool schema 的 parameters 声明 title 字段（open/submit/wait required，close optional）
 * 2. engine 处理 tool call 时把 title 记录到 ThreadAction.title 字段（持久化）
 * 3. SSE flow:action 事件 payload 包含 title
 *
 * @ref docs/工程管理/迭代/all/20260421_feature_工具调用title参数.md
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

import { runWithThreadTree, type EngineConfig } from "../src/thinkable/engine/engine.js";
import { MockLLMClient, type ToolCall } from "../src/thinkable/client.js";
import type { StoneData } from "../src/types/index.js";
import { eventBus } from "../src/observable/server/events.js";
import { OPEN_TOOL, SUBMIT_TOOL, CLOSE_TOOL, WAIT_TOOL } from "../src/executable/tools/index.js";

const TEST_DIR = join(import.meta.dir, ".tmp_thread_title_test");
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

beforeEach(() => {
  mkdirSync(FLOWS_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
  eventBus.removeAllListeners("sse");
});

/* ========== 1. Schema 契约 ========== */

describe("tool schema — title 参数", () => {
  test("open tool 的 parameters 声明 title", () => {
    const params = OPEN_TOOL.function.parameters as {
      properties: Record<string, { type: string; description?: string }>;
      required?: string[];
    };
    expect(params.properties).toHaveProperty("title");
    expect(params.properties.title!.type).toBe("string");
    expect(params.required).toContain("title");
  });

  test("submit tool 的 parameters 声明 title", () => {
    const params = SUBMIT_TOOL.function.parameters as {
      properties: Record<string, { type: string }>;
      required?: string[];
    };
    expect(params.properties).toHaveProperty("title");
    expect(params.properties.title!.type).toBe("string");
    expect(params.required).toContain("title");
  });

  test("close tool 的 title 为 optional（语义上冗余）", () => {
    /* close 仅是关闭动作，意图自明，title 可选 */
    const params = CLOSE_TOOL.function.parameters as {
      properties: Record<string, unknown>;
      required?: string[];
    };
    /* close 当前无 title 字段；若未来加上，也应为 optional */
    expect(params.required ?? []).not.toContain("title");
  });

  test("wait tool 的 parameters 声明 title", () => {
    const params = WAIT_TOOL.function.parameters as {
      properties: Record<string, unknown>;
      required?: string[];
    };
    /* wait 已有 reason 参数，此次未加 title（保持现状，title 可选） */
    expect(params.required ?? []).toContain("reason");
  });
});

/* ========== 2. Engine 记录 title 到 ThreadAction ========== */

describe("engine — title 持久化到 ThreadAction", () => {
  test("tool_use action.title 被写入 threadData", async () => {
    let formId = "f_unknown";
    const steps = [
      /* step 1: open with title */
      () => ({
        content: "",
        toolCalls: [toolCall("open", {
          title: "打开 return 表单",
          type: "command",
          command: "return",
          description: "准备返回",
        })],
      }),
      /* step 2: submit with title（从 context 中读 form_id） */
      (messages: unknown[]) => {
        const userMsg = (messages as Array<{ role: string; content: string }>).find((m) => m.role === "user");
        const m = userMsg?.content.match(/<form id="(f_[^"]+)" command="return"/);
        if (m?.[1]) formId = m[1];
        return {
          content: "",
          toolCalls: [toolCall("submit", {
            title: "提交返回结果",
            form_id: formId,
            summary: "任务完成",
          })],
        };
      },
    ];
    let i = 0;
    const llm = new MockLLMClient({
      responseFn: (messages) => {
        const step = steps[i++] ?? steps[steps.length - 1]!;
        return step(messages);
      },
    });

    const config: EngineConfig = {
      rootDir: TEST_DIR,
      flowsDir: FLOWS_DIR,
      llm,
      directory: [],
      traits: [],
      stone: makeStone("test_obj"),
      schedulerConfig: {
        maxIterationsPerThread: 10,
        maxTotalIterations: 20,
        deadlockGracePeriodMs: 0,
      },
    };

    const result = await runWithThreadTree("test_obj", "你好", "user", config);

    expect(result.status).toBe("done");

    /* 读取落盘 thread.json，检查 tool_use action 的 title 字段 */
    const sessionDir = join(FLOWS_DIR, result.sessionId);
    const threadsJsonPath = join(sessionDir, "objects", "test_obj", "threads.json");
    const threadsJson = JSON.parse(await Bun.file(threadsJsonPath).text());
    const rootId = threadsJson.rootId as string;
    const threadPath = join(sessionDir, "objects", "test_obj", "threads", rootId, "thread.json");
    const thread = JSON.parse(await Bun.file(threadPath).text());
    const toolUses = (thread.actions as Array<{ type: string; name?: string; title?: string; args?: Record<string, unknown> }>)
      .filter((a) => a.type === "tool_use");

    expect(toolUses.length).toBe(2);
    expect(toolUses[0]?.name).toBe("open");
    expect(toolUses[0]?.title).toBe("打开 return 表单");
    expect(toolUses[1]?.name).toBe("submit");
    expect(toolUses[1]?.title).toBe("提交返回结果");
    /* 注意：title 作为顶层行动标题存储在 ThreadAction.title；
     * 为兼容 think(fork) 的 title→子线程名用法，args.title 可能仍保留。
     * 前端以 ThreadAction.title 为准展示。 */
  });
});

/* ========== 3. SSE 事件广播 title ========== */

describe("SSE — flow:action 事件包含 title", () => {
  test("tool call 带 title 时 SSE 发送 title", async () => {
    const captured: Array<{ type: string; action?: { name?: string; title?: string } }> = [];
    eventBus.on("sse", (e) => captured.push(e));

    let formId = "f_unknown";
    const steps = [
      () => ({
        content: "",
        toolCalls: [toolCall("open", {
          title: "开始准备回复",
          type: "command",
          command: "return",
          description: "准备返回",
        })],
      }),
      (messages: unknown[]) => {
        const userMsg = (messages as Array<{ role: string; content: string }>).find((m) => m.role === "user");
        const m = userMsg?.content.match(/<form id="(f_[^"]+)" command="return"/);
        if (m?.[1]) formId = m[1];
        return {
          content: "",
          toolCalls: [toolCall("submit", {
            title: "提交最终回复",
            form_id: formId,
            summary: "完成",
          })],
        };
      },
    ];
    let i = 0;
    const llm = new MockLLMClient({
      responseFn: (messages) => {
        const step = steps[i++] ?? steps[steps.length - 1]!;
        return step(messages);
      },
    });

    const config: EngineConfig = {
      rootDir: TEST_DIR,
      flowsDir: FLOWS_DIR,
      llm,
      directory: [],
      traits: [],
      stone: makeStone("test_obj"),
      schedulerConfig: {
        maxIterationsPerThread: 10,
        maxTotalIterations: 20,
        deadlockGracePeriodMs: 0,
      },
    };

    await runWithThreadTree("test_obj", "你好", "user", config);

    const toolUseActions = captured
      .filter((e) => e.type === "flow:action" && e.action?.name && e.action?.title);

    expect(toolUseActions.length).toBeGreaterThanOrEqual(2);
    const titles = toolUseActions.map((e) => e.action!.title);
    expect(titles).toContain("开始准备回复");
    expect(titles).toContain("提交最终回复");
  });

  test("tool call 无 title 时不因 title 发送多余 SSE", async () => {
    const captured: Array<{ type: string; action?: { title?: string } }> = [];
    eventBus.on("sse", (e) => captured.push(e));

    let formId = "f_unknown";
    const steps = [
      () => ({
        content: "",
        toolCalls: [toolCall("open", {
          /* 没有 title */
          type: "command",
          command: "return",
          description: "准备返回",
        })],
      }),
      (messages: unknown[]) => {
        const userMsg = (messages as Array<{ role: string; content: string }>).find((m) => m.role === "user");
        const m = userMsg?.content.match(/<form id="(f_[^"]+)" command="return"/);
        if (m?.[1]) formId = m[1];
        return {
          content: "",
          toolCalls: [toolCall("submit", {
            /* 没有 title */
            form_id: formId,
            summary: "完成",
          })],
        };
      },
    ];
    let i = 0;
    const llm = new MockLLMClient({
      responseFn: (messages) => {
        const step = steps[i++] ?? steps[steps.length - 1]!;
        return step(messages);
      },
    });

    const config: EngineConfig = {
      rootDir: TEST_DIR,
      flowsDir: FLOWS_DIR,
      llm,
      directory: [],
      traits: [],
      stone: makeStone("test_obj"),
      schedulerConfig: {
        maxIterationsPerThread: 10,
        maxTotalIterations: 20,
        deadlockGracePeriodMs: 0,
      },
    };

    await runWithThreadTree("test_obj", "你好", "user", config);

    /* 无 title 的 tool call 不会因 title 触发 flow:action（只有 think(fork) 等原有事件） */
    const titledActions = captured.filter((e) => e.type === "flow:action" && e.action?.title);
    expect(titledActions.length).toBe(0);
  });
});

/* ========== 4. think(fork)：title 同时作为子线程名 ========== */

describe("think(fork) — title 即子线程名", () => {
  /**
   * scheduler 调度多线程时，同一 mock LLM 会被父子两个线程共用。
   * 走完整流程：
   * - 父线程 call 1：open think
   * - 父线程 call 2：submit（title = 子线程名，context="fork"）
   * - 切到子线程：call 3/4 子线程 open+submit return
   * - 切回父线程：call 5/6 父线程 open+submit return
   */
  function buildSteps(submitArgs: { title: string; msg?: string; context?: string }) {
    const state: { parentFormId?: string } = {};
    let phase = 0;
    return (messages: unknown[]): { content: string; toolCalls: ToolCall[] } => {
      const userContent = (messages as Array<{ role: string; content: string }>).find((m) => m.role === "user")?.content ?? "";
      const isChild = /creator mode="sub_thread"/.test(userContent);
      /* 子线程：立即 open+submit return */
      if (isChild) {
        const formMatch = userContent.match(/<form id="(f_[^"]+)" command="return"/);
        if (formMatch?.[1]) {
          return { content: "", toolCalls: [toolCall("submit", { title: "子返回", form_id: formMatch[1], summary: "子完成" })] };
        }
        return { content: "", toolCalls: [toolCall("open", { title: "子 open return", type: "command", command: "return", description: "完成" })] };
      }
      /* 父线程 */
      if (phase === 0) {
        phase = 1;
        return { content: "", toolCalls: [toolCall("open", { title: "父开始 think(fork)", type: "command", command: "think", description: "派生" })] };
      }
      if (phase === 1) {
        const m = userContent.match(/<form id="(f_[^"]+)" command="think"/);
        state.parentFormId = m?.[1] ?? "f_unknown";
        phase = 2;
        return { content: "", toolCalls: [toolCall("submit", { form_id: state.parentFormId, context: "fork", ...submitArgs })] };
      }
      /* phase 2+: 等子线程完成后父线程继续；open+submit return */
      const rm = userContent.match(/<form id="(f_[^"]+)" command="return"/);
      if (rm?.[1]) {
        return { content: "", toolCalls: [toolCall("submit", { title: "父提交 return", form_id: rm[1], summary: "父完成" })] };
      }
      return { content: "", toolCalls: [toolCall("open", { title: "父 open return", type: "command", command: "return", description: "完成" })] };
    };
  }

  test("submit 的 title 直接作为子线程标题（同时也是 tool action.title）", async () => {
    const llm = new MockLLMClient({
      responseFn: buildSteps({ title: "分析任务", msg: "派生分析子任务" }),
    });

    const config: EngineConfig = {
      rootDir: TEST_DIR,
      flowsDir: FLOWS_DIR,
      llm,
      directory: [],
      traits: [],
      stone: makeStone("test_obj"),
      schedulerConfig: {
        maxIterationsPerThread: 20,
        maxTotalIterations: 40,
        deadlockGracePeriodMs: 0,
      },
    };

    const result = await runWithThreadTree("test_obj", "你好", "user", config);
    expect(result.status).toBe("done");

    const sessionDir = join(FLOWS_DIR, result.sessionId);
    const threadsJsonPath = join(sessionDir, "objects", "test_obj", "threads.json");
    const threadsJson = JSON.parse(await Bun.file(threadsJsonPath).text());
    /* 找到非 root 节点，其 title 应等于 submit 的 title */
    const rootId = threadsJson.rootId;
    const childEntry = Object.entries(threadsJson.nodes as Record<string, { title: string }>).find(([id]) => id !== rootId);
    expect(childEntry).toBeTruthy();
    expect(childEntry![1].title).toBe("分析任务");

    /* 同时验证：父线程的 submit tool_use action.title 也等于同一个值 */
    const parentThreadPath = join(sessionDir, "objects", "test_obj", "threads", rootId, "thread.json");
    const parentThread = JSON.parse(await Bun.file(parentThreadPath).text());
    const parentSubmits = (parentThread.actions as Array<{ type: string; name?: string; title?: string; args?: Record<string, unknown> }>)
      .filter((a) => a.type === "tool_use" && a.name === "submit" && (a.args?.["form_id"] ?? "").toString().startsWith("f_"));
    /* 找到 think(fork) 那次 submit：它的 title 即子线程名 */
    const createSubmit = parentSubmits.find((a) => a.title === "分析任务");
    expect(createSubmit).toBeTruthy();
  });
});
