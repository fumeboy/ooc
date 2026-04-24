/**
 * 线程树执行引擎测试
 *
 * 使用 mock LLM 验证 engine 的完整执行流程：
 * - 单轮对话（tool call: return）
 * - 多轮迭代（思考多轮 → return）
 * - 子线程创建与调度
 * - 错误处理
 * - SSE 事件发射
 *
 * 测试使用 tool-calling 协议 mock（open + submit 每个 command 两轮工具调用），
 * 与生产路径保持一致。TOML 兼容路径已删除。
 *
 * @ref docs/superpowers/specs/2026-04-06-thread-tree-architecture-design.md
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, existsSync, writeFileSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { runWithThreadTree, type EngineConfig } from "../src/thread/engine.js";
import { MockLLMClient, type ToolCall, type MockLLMResponseFnResult } from "../src/thinkable/client.js";
import type { StoneData, DirectoryEntry, TraitDefinition } from "../src/types/index.js";
import { eventBus } from "../src/server/events.js";

const TEST_DIR = join(import.meta.dir, ".tmp_thread_engine_test");
const FLOWS_DIR = join(TEST_DIR, "flows");

/** 创建最小 StoneData */
function makeStone(name: string): StoneData {
  return {
    name,
    thinkable: { whoAmI: `我是 ${name}，一个测试对象` },
    talkable: { whoAmI: `${name} 简介`, functions: [] },
    data: {},
    relations: [],
    traits: [],
  };
}

/** 构造 tool call 数据结构 */
function toolCall(name: string, args: Record<string, unknown>): ToolCall {
  return {
    id: `tc_${Math.random().toString(36).slice(2, 8)}`,
    type: "function",
    function: { name, arguments: JSON.stringify(args) },
  };
}

/**
 * 脚本式 tool-call mock：接收一个 step 数组，按顺序每轮返回一步。
 * 每一步可以是：
 *   - string —— thinking content（不触发 tool call）
 *   - ToolCall —— 直接返回此 tool call
 *   - () => ToolCall | string | MockLLMResponseFnResult —— 动态生成
 */
type MockStep = string | ToolCall | ((messages: unknown[]) => MockLLMResponseFnResult);

function makeScript(steps: MockStep[]): (messages: unknown[]) => MockLLMResponseFnResult {
  let i = 0;
  return (messages: unknown[]) => {
    const step = steps[i++] ?? steps[steps.length - 1];
    if (typeof step === "function") {
      return step(messages);
    }
    if (typeof step === "string") {
      /* thinking content 模拟：无 tool call */
      return { content: "", thinkingContent: step };
    }
    /* ToolCall */
    return { content: "", toolCalls: [step] };
  };
}

/** 捷径：open(command) 后紧跟 submit(...) 的两步脚本步骤生成器 */
function openSubmit(command: string, submitArgs: Record<string, unknown>): MockStep[] {
  /* submit 需要 form_id，我们在 submit 步实时从历史中提取（每次 open 返回的 form_id 都一样 form_xxx）。
   * 但 engine 侧对 form_id 的校验会走 FormManager，因此直接回放一个合法的 form_id。
   *
   * 做法：open 时发 tool call，engine 生成 form_id 并写入 activeForms；
   * submit 步用 closure 从上一轮 tree 读取 activeForms 恢复 form_id。
   *
   * 这里用占位符，真正的 form_id 在 submit 步由闭包回填。
   */
  const state: { formId?: string } = {};
  return [
    /* step 1: open */
    (_messages: unknown[]) => {
      return { content: "", toolCalls: [toolCall("open", { type: "command", command, description: `测试执行 ${command}` })] };
    },
    /* step 2: submit（engine 已把 form_id 写入 threadData.activeForms，我们从 context 里找到它） */
    (messages: unknown[]) => {
      const userMsg = (messages as Array<{ role: string; content: string }>).find((m) => m.role === "user");
      /* form_id 形如 f_xxx，active-forms XML：<form id="f_xxx" command="..."> */
      const re = /<form id="(f_[^"]+)" command="([^"]+)"/g;
      let formId = "f_unknown";
      let m: RegExpExecArray | null;
      while ((m = re.exec(userMsg?.content ?? "")) !== null) {
        if (m[2] === command) {
          formId = m[1]!;
          state.formId = formId;
          break;
        }
      }
      if (!state.formId && state.formId !== undefined) {
        formId = state.formId;
      }
      return { content: "", toolCalls: [toolCall("submit", { form_id: formId, ...submitArgs })] };
    },
  ];
}

/** 单步 tool call：return 是最常用的终止方式 */
function scriptReturn(summary: string): MockStep[] {
  return openSubmit("return", { summary });
}

/** 单步 tool call：talk */
function scriptTalk(target: string, message: string): MockStep[] {
  return openSubmit("talk", { target, message });
}

/** 单步 tool call：set_plan */
function scriptSetPlan(text: string): MockStep[] {
  return openSubmit("set_plan", { text });
}

/** 不触发 tool 调用的思考步骤（仅 thinking） */
function scriptThought(content: string): MockStep {
  return content;
}

/** 单步 tool call：open(file)，用于检查下一轮 Context 里的文件窗口 */
function scriptOpenFile(path: string, args: Record<string, unknown> = {}): MockStep {
  return () => ({
    content: "",
    toolCalls: [toolCall("open", { type: "file", title: "读取测试文件", path, description: "读取测试文件", ...args })],
  });
}

function allMessageContent(messages: unknown[]): string {
  return (messages as Array<{ content?: string }>).map((m) => m.content ?? "").join("\n");
}

function findGeneratedFile(root: string, fileName: string): string | null {
  if (!existsSync(root)) return null;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isFile() && entry.name === fileName) return path;
    if (entry.isDirectory()) {
      const found = findGeneratedFile(path, fileName);
      if (found) return found;
    }
  }
  return null;
}

/** 创建基础 EngineConfig */
function makeConfig(overrides?: {
  steps?: MockStep[];
  stone?: StoneData;
  directory?: DirectoryEntry[];
  traits?: TraitDefinition[];
  schedulerConfig?: EngineConfig["schedulerConfig"];
  onTalk?: EngineConfig["onTalk"];
}): EngineConfig {
  const llm = new MockLLMClient({
    responseFn: overrides?.steps ? makeScript(overrides.steps) : undefined,
  });

  return {
    rootDir: TEST_DIR,
    flowsDir: FLOWS_DIR,
    llm,
    directory: overrides?.directory ?? [],
    traits: overrides?.traits ?? [],
    stone: overrides?.stone ?? makeStone("test_obj"),
    onTalk: overrides?.onTalk,
    schedulerConfig: overrides?.schedulerConfig ?? {
      maxIterationsPerThread: 20,
      maxTotalIterations: 50,
      deadlockGracePeriodMs: 0,
    },
  };
}

beforeEach(() => {
  mkdirSync(FLOWS_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
  /* 清理 SSE 事件监听器 */
  eventBus.removeAllListeners("sse");
});

/* ========== 基础执行 ========== */

describe("基础执行", () => {
  test("talk(this_thread_creator, wait=true) 解析为 user 并等待，不再需要 return", async () => {
    const calls: Array<{
      target: string;
      message: string;
      continueThreadId?: string;
      forkUnderThreadId?: string;
    }> = [];

    const config = makeConfig({
      steps: openSubmit("talk", {
        target: "this_thread_creator",
        context: "continue",
        msg: "你好，我已经收到。",
        wait: true,
      }),
      onTalk: async (target, message, _from, _fromThread, _sid, continueThreadId, _messageId, forkUnderThreadId) => {
        calls.push({ target, message, continueThreadId, forkUnderThreadId });
        return { reply: null, remoteThreadId: "user" };
      },
    });

    const result = await runWithThreadTree("test_obj", "hi", "user", config);

    expect(result.status).toBe("waiting");
    expect(calls).toEqual([{
      target: "user",
      message: "你好，我已经收到。",
      continueThreadId: undefined,
      forkUnderThreadId: undefined,
    }]);
  });

  test("单轮对话：return → done", async () => {
    const config = makeConfig({ steps: scriptReturn("任务完成") });

    const result = await runWithThreadTree("test_obj", "你好", "user", config);

    expect(result.status).toBe("done");
    expect(result.summary).toBe("任务完成");
    expect(result.sessionId).toBeTruthy();
    /* open+submit 两轮 */
    expect(result.totalIterations).toBe(2);
  });

  test("多轮迭代：思考 → 思考 → return", async () => {
    const config = makeConfig({
      steps: [
        scriptThought("第 1 轮思考"),
        scriptThought("第 2 轮思考"),
        ...scriptReturn("经过多轮思考完成"),
      ],
    });

    const result = await runWithThreadTree("test_obj", "复杂任务", "user", config);

    expect(result.status).toBe("done");
    expect(result.summary).toBe("经过多轮思考完成");
    /* 2 轮思考 + 2 轮 open+submit = 4 轮 */
    expect(result.totalIterations).toBe(4);
  });

  test("session 目录被正确创建", async () => {
    const config = makeConfig({ steps: scriptReturn("完成") });

    const result = await runWithThreadTree("test_obj", "你好", "user", config);

    const sessionDir = join(FLOWS_DIR, result.sessionId);
    expect(existsSync(sessionDir)).toBe(true);

    const objectDir = join(sessionDir, "objects", "test_obj");
    expect(existsSync(objectDir)).toBe(true);
  });

  test("初始消息被写入 Root 线程的 inbox", async () => {
    let receivedInbox = false;
    const steps: MockStep[] = [
      (messages: unknown[]) => {
        const userMsg = (messages as Array<{ role: string; content: string }>).find((m) => m.role === "user");
        if (userMsg && userMsg.content.includes("你好世界")) {
          receivedInbox = true;
        }
        return { content: "", toolCalls: [toolCall("open", { type: "command", command: "return", description: "完成" })] };
      },
      (messages: unknown[]) => {
        const userMsg = (messages as Array<{ role: string; content: string }>).find((m) => m.role === "user");
        const m = userMsg?.content.match(/<form id="(f_[^\"]+)" command="return"/);
        return { content: "", toolCalls: [toolCall("submit", { form_id: m?.[1] ?? "form_unknown", summary: "收到消息" })] };
      },
    ];

    const config = makeConfig({ steps });
    await runWithThreadTree("test_obj", "你好世界", "user", config);

    expect(receivedInbox).toBe(true);
  });

  test("非 debug/pause 模式下每轮也会覆盖写出最新 llm 输入输出文件", async () => {
    const steps: MockStep[] = [
      () => ({
        content: "first llm output",
        toolCalls: [toolCall("open", { type: "command", command: "return", description: "完成" })],
      }),
      (messages: unknown[]) => {
        const userMsg = (messages as Array<{ role: string; content: string }>).find((m) => m.role === "user")?.content ?? "";
        const m = userMsg.match(/<form id="(f_[^\"]+)" command="return"/);
        return {
          content: "latest llm output",
          toolCalls: [toolCall("submit", { form_id: m?.[1] ?? "form_unknown", summary: "完成" })],
        };
      },
    ];

    const result = await runWithThreadTree("test_obj", "写出 llm 文件", "user", makeConfig({ steps }));
    const objectDir = join(FLOWS_DIR, result.sessionId, "objects", "test_obj");
    const inputPath = findGeneratedFile(objectDir, "llm.input.txt");
    const outputPath = findGeneratedFile(objectDir, "llm.output.txt");

    expect(result.status).toBe("done");
    expect(inputPath).toBeTruthy();
    expect(outputPath).toBeTruthy();
    expect(readFileSync(inputPath!, "utf-8")).toContain("<system>");
    expect(readFileSync(outputPath!, "utf-8")).toBe("latest llm output");
  });

  test("open file 默认只展示前 200 行且每行最多 200 字符", async () => {
    const longFirstLine = "x".repeat(205);
    const fileContent = [longFirstLine, ...Array.from({ length: 200 }, (_, i) => `line-${i + 2}`)].join("\n");
    writeFileSync(join(TEST_DIR, "long.txt"), fileContent);

    let inspectedContext = "";
    const steps: MockStep[] = [
      scriptOpenFile("long.txt"),
      (messages: unknown[]) => {
        inspectedContext = allMessageContent(messages);
        return { content: "", toolCalls: [toolCall("open", { type: "command", command: "return", description: "结束" })] };
      },
      (messages: unknown[]) => {
        const userMsg = (messages as Array<{ role: string; content: string }>).find((m) => m.role === "user")?.content ?? "";
        const m = userMsg.match(/<form id="(f_[^\"]+)" command="return"/);
        return { content: "", toolCalls: [toolCall("submit", { form_id: m?.[1] ?? "form_unknown", summary: "done" })] };
      },
    ];

    const result = await runWithThreadTree("test_obj", "读取文件", "user", makeConfig({ steps }));

    expect(result.status).toBe("done");
    expect(inspectedContext).toContain(`${"x".repeat(200)}... （超长省略后续 5 字符）`);
    expect(inspectedContext).toContain("line-200");
    expect(inspectedContext).not.toContain("line-201");
    expect(inspectedContext).toContain("... （超长省略后续 1 行）");
  });

  test("open file 支持 columns 参数限制每行字符数", async () => {
    writeFileSync(join(TEST_DIR, "columns.txt"), ["abcdefghijk", "second-line"].join("\n"));

    let inspectedContext = "";
    const steps: MockStep[] = [
      scriptOpenFile("columns.txt", { lines: -1, columns: 10 }),
      (messages: unknown[]) => {
        inspectedContext = allMessageContent(messages);
        return { content: "", toolCalls: [toolCall("open", { type: "command", command: "return", description: "结束" })] };
      },
      (messages: unknown[]) => {
        const userMsg = (messages as Array<{ role: string; content: string }>).find((m) => m.role === "user")?.content ?? "";
        const m = userMsg.match(/<form id="(f_[^\"]+)" command="return"/);
        return { content: "", toolCalls: [toolCall("submit", { form_id: m?.[1] ?? "form_unknown", summary: "done" })] };
      },
    ];

    const result = await runWithThreadTree("test_obj", "读取文件", "user", makeConfig({ steps }));

    expect(result.status).toBe("done");
    expect(inspectedContext).toContain("abcdefghij... （超长省略后续 1 字符）");
    expect(inspectedContext).toContain("second-lin... （超长省略后续 1 字符）");
    expect(inspectedContext).not.toContain("超长省略后续 1 行");
  });

  test("open file 的 lines=-1 且 columns=-1 表示不限制", async () => {
    const longFirstLine = "y".repeat(205);
    const fileContent = [longFirstLine, ...Array.from({ length: 200 }, (_, i) => `line-${i + 2}`)].join("\n");
    writeFileSync(join(TEST_DIR, "unlimited.txt"), fileContent);

    let inspectedContext = "";
    const steps: MockStep[] = [
      scriptOpenFile("unlimited.txt", { lines: -1, columns: -1 }),
      (messages: unknown[]) => {
        inspectedContext = allMessageContent(messages);
        return { content: "", toolCalls: [toolCall("open", { type: "command", command: "return", description: "结束" })] };
      },
      (messages: unknown[]) => {
        const userMsg = (messages as Array<{ role: string; content: string }>).find((m) => m.role === "user")?.content ?? "";
        const m = userMsg.match(/<form id="(f_[^\"]+)" command="return"/);
        return { content: "", toolCalls: [toolCall("submit", { form_id: m?.[1] ?? "form_unknown", summary: "done" })] };
      },
    ];

    const result = await runWithThreadTree("test_obj", "读取文件", "user", makeConfig({ steps }));

    expect(result.status).toBe("done");
    expect(inspectedContext).toContain(longFirstLine);
    expect(inspectedContext).toContain("line-201");
    expect(inspectedContext).not.toContain("超长省略后续");
  });
});

describe("talk 自动 ack 兜底", () => {
  test("仅当 target 只有一条未读且为最新消息，且 talk 未显式 mark 时自动 ack", async () => {
    let firstCallSawInboxId = false;
    let laterCallHasInbox = false;
    let stage = 0;

    const steps: MockStep[] = [
      /* 轮 1: open talk */
      (messages: unknown[]) => {
        const userMsg = (messages as Array<{ role: string; content: string }>).find((m) => m.role === "user")?.content ?? "";
        /* inbox 消息在 context 中形如 <message id="msg_xxx" from="user" status="unread"> */
        if (/id="msg_[^"]+"\s+from="user"\s+status="unread"/.test(userMsg)) {
          firstCallSawInboxId = true;
        }
        return { content: "", toolCalls: [toolCall("open", { type: "command", command: "talk", description: "回复 user" })] };
      },
      /* 轮 2: submit talk */
      (messages: unknown[]) => {
        const userMsg = (messages as Array<{ role: string; content: string }>).find((m) => m.role === "user")?.content ?? "";
        const m = userMsg.match(/<form id="(f_[^\"]+)" command="talk"/);
        return { content: "", toolCalls: [toolCall("submit", { form_id: m?.[1] ?? "form_unknown", target: "user", message: "收到" })] };
      },
      /* 轮 3: open return */
      (messages: unknown[]) => {
        stage++;
        const userMsg = (messages as Array<{ role: string; content: string }>).find((m) => m.role === "user")?.content ?? "";
        /* stage >= 3 时检查：inbox 应该已被 ack */
        if (userMsg.includes("未读消息")) {
          laterCallHasInbox = true;
        }
        return { content: "", toolCalls: [toolCall("open", { type: "command", command: "return", description: "结束" })] };
      },
      /* 轮 4: submit return */
      (messages: unknown[]) => {
        const userMsg = (messages as Array<{ role: string; content: string }>).find((m) => m.role === "user")?.content ?? "";
        const m = userMsg.match(/<form id="(f_[^\"]+)" command="return"/);
        return { content: "", toolCalls: [toolCall("submit", { form_id: m?.[1] ?? "form_unknown", summary: "done" })] };
      },
    ];

    const config = makeConfig({
      steps,
      onTalk: async () => ({ reply: null, remoteThreadId: "th_mock" }),
    });

    const result = await runWithThreadTree("test_obj", "hi", "user", config);
    expect(result.status).toBe("done");
    expect(firstCallSawInboxId).toBe(true);
    expect(laterCallHasInbox).toBe(false);

    /* 读取落盘 thread.json，确认 inbox 状态已被标记 */
    const sessionDir = join(FLOWS_DIR, result.sessionId);
    const threadsJsonPath = join(sessionDir, "objects", "test_obj", "threads.json");
    const threadsJson = JSON.parse(await Bun.file(threadsJsonPath).text());
    const rootId = threadsJson.rootId as string;
    const threadPath = join(sessionDir, "objects", "test_obj", "threads", rootId, "thread.json");
    const thread = JSON.parse(await Bun.file(threadPath).text());
    const inbox = thread.inbox as Array<{ status: string; mark?: { type: string } }>;
    expect(Array.isArray(inbox)).toBe(true);
    const marked = inbox.find((m) => m.status === "marked");
    expect(marked).toBeTruthy();
    expect(marked?.mark?.type).toBe("ack");
  });
});

/* ========== 计划更新 ========== */

describe("计划更新", () => {
  test("set_plan 更新后在下一轮 Context 中可见", async () => {
    let planVisibleLater = false;

    const steps: MockStep[] = [
      /* 轮 1: open set_plan */
      ...openSubmit("set_plan", { text: "第一步：分析需求" }),
      /* 轮 3: 检查 plan 是否在 context 中；此时再 open return */
      (messages: unknown[]) => {
        const userMsg = (messages as Array<{ role: string; content: string }>).find((m) => m.role === "user");
        if (userMsg && userMsg.content.includes("第一步：分析需求")) {
          planVisibleLater = true;
        }
        return { content: "", toolCalls: [toolCall("open", { type: "command", command: "return", description: "结束" })] };
      },
      /* 轮 4: submit return */
      (messages: unknown[]) => {
        const userMsg = (messages as Array<{ role: string; content: string }>).find((m) => m.role === "user")?.content ?? "";
        const m = userMsg.match(/<form id="(f_[^\"]+)" command="return"/);
        return { content: "", toolCalls: [toolCall("submit", { form_id: m?.[1] ?? "form_unknown", summary: "计划执行完毕" })] };
      },
    ];
    const config = makeConfig({ steps });

    const result = await runWithThreadTree("test_obj", "制定计划", "user", config);

    expect(result.status).toBe("done");
    expect(planVisibleLater).toBe(true);
  });
});

/* ========== 安全阀 ========== */

describe("安全阀", () => {
  test("单线程迭代上限 → failed", async () => {
    const config = makeConfig({
      steps: [scriptThought("无限思考")],
      schedulerConfig: {
        maxIterationsPerThread: 5,
        maxTotalIterations: 100,
        deadlockGracePeriodMs: 0,
      },
    });

    const result = await runWithThreadTree("test_obj", "无限任务", "user", config);

    expect(result.status).toBe("failed");
    expect(result.totalIterations).toBe(5);
  });

  test("全局迭代上限 → failed", async () => {
    const config = makeConfig({
      steps: [scriptThought("无限思考")],
      schedulerConfig: {
        maxIterationsPerThread: 100,
        maxTotalIterations: 3,
        deadlockGracePeriodMs: 0,
      },
    });

    const result = await runWithThreadTree("test_obj", "无限任务", "user", config);

    expect(result.status).toBe("failed");
    expect(result.totalIterations).toBeLessThanOrEqual(3);
  });
});

/* ========== SSE 事件 ========== */

describe("SSE 事件", () => {
  test("发射 flow:start 和 flow:end 事件", async () => {
    const events: Array<{ type: string; objectName?: string; status?: string }> = [];
    eventBus.on("sse", (e) => events.push(e));

    const config = makeConfig({ steps: scriptReturn("完成") });
    await runWithThreadTree("test_obj", "你好", "user", config);

    const startEvents = events.filter((e) => e.type === "flow:start");
    const endEvents = events.filter((e) => e.type === "flow:end");

    expect(startEvents.length).toBe(1);
    expect(startEvents[0]?.objectName).toBe("test_obj");

    expect(endEvents.length).toBe(1);
    expect(endEvents[0]?.objectName).toBe("test_obj");
    expect(endEvents[0]?.status).toBe("idle");
  });

  test("发射 flow:progress 事件", async () => {
    const events: Array<{ type: string; iterations?: number }> = [];
    eventBus.on("sse", (e) => events.push(e));

    const config = makeConfig({ steps: scriptReturn("完成") });
    await runWithThreadTree("test_obj", "你好", "user", config);

    const progressEvents = events.filter((e) => e.type === "flow:progress");
    expect(progressEvents.length).toBeGreaterThanOrEqual(1);
    expect(progressEvents[0]?.iterations).toBeGreaterThanOrEqual(1);
  });

  test("失败时 flow:end 状态为 error", async () => {
    const events: Array<{ type: string; status?: string }> = [];
    eventBus.on("sse", (e) => events.push(e));

    const config = makeConfig({
      steps: [scriptThought("无限")],
      schedulerConfig: {
        maxIterationsPerThread: 2,
        maxTotalIterations: 100,
        deadlockGracePeriodMs: 0,
      },
    });

    await runWithThreadTree("test_obj", "失败任务", "user", config);

    const endEvents = events.filter((e) => e.type === "flow:end");
    expect(endEvents.length).toBe(1);
    expect(endEvents[0]?.status).toBe("error");
  });
});

/* ========== 错误处理 ========== */

describe("错误处理", () => {
  test("LLM 调用失败 → 线程 failed", async () => {
    let callCount = 0;
    const llm = new MockLLMClient({
      responseFn: () => {
        callCount++;
        if (callCount === 1) {
          throw new Error("LLM rate limit exceeded");
        }
        return "";
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
        maxIterationsPerThread: 20,
        maxTotalIterations: 50,
        deadlockGracePeriodMs: 0,
      },
    };

    const result = await runWithThreadTree("test_obj", "你好", "user", config);
    const objectDir = join(FLOWS_DIR, result.sessionId, "objects", "test_obj");
    const inputPath = findGeneratedFile(objectDir, "llm.input.txt");
    const outputPath = findGeneratedFile(objectDir, "llm.output.txt");

    expect(result.status).toBe("failed");
    expect(inputPath).toBeTruthy();
    expect(readFileSync(inputPath!, "utf-8")).toContain("<system>");
    expect(outputPath).toBeNull();
  });

  test("空 LLM 输出 → 继续迭代（不崩溃）", async () => {
    const steps: MockStep[] = [
      () => ({ content: "", thinkingContent: "" }),
      () => ({ content: "", thinkingContent: "" }),
      ...scriptReturn("最终完成"),
    ];
    const config = makeConfig({ steps });

    const result = await runWithThreadTree("test_obj", "你好", "user", config);

    expect(result.status).toBe("done");
    expect(result.totalIterations).toBe(4);
  });
});

/* ========== 暂停 ========== */

describe("暂停", () => {
  test("isPaused 为 true → 不执行迭代", async () => {
    let iterCount = 0;
    const config = makeConfig({
      steps: [(() => { iterCount++; return ""; }) as MockStep],
    });
    config.isPaused = () => true;

    const result = await runWithThreadTree("test_obj", "你好", "user", config);

    /* 暂停时 Scheduler 不调度，Root 保持 running */
    expect(iterCount).toBe(0);
    expect(result.status).toBe("running");
  });
});

/* ========== Context 构建 ========== */

describe("Context 构建", () => {
  test("Stone 的 whoAmI 出现在 system message 中", async () => {
    let systemMsg = "";
    const steps: MockStep[] = [
      (messages: unknown[]) => {
        const sys = (messages as Array<{ role: string; content: string }>).find((m) => m.role === "system");
        if (sys) systemMsg = sys.content;
        return { content: "", toolCalls: [toolCall("open", { type: "command", command: "return", description: "完成" })] };
      },
      (messages: unknown[]) => {
        const userMsg = (messages as Array<{ role: string; content: string }>).find((m) => m.role === "user")?.content ?? "";
        const m = userMsg.match(/<form id="(f_[^\"]+)" command="return"/);
        return { content: "", toolCalls: [toolCall("submit", { form_id: m?.[1] ?? "form_unknown", summary: "完成" })] };
      },
    ];

    const config = makeConfig({ stone: makeStone("哲学家"), steps });
    await runWithThreadTree("哲学家", "你好", "user", config);

    expect(systemMsg).toContain("哲学家");
    expect(systemMsg).toContain("我是 哲学家");
  });

  test("directory 中的对象出现在 user message 中", async () => {
    let userMsg = "";
    const steps: MockStep[] = [
      (messages: unknown[]) => {
        const u = (messages as Array<{ role: string; content: string }>).find((m) => m.role === "user");
        if (u) userMsg = u.content;
        return { content: "", toolCalls: [toolCall("open", { type: "command", command: "return", description: "完成" })] };
      },
      (messages: unknown[]) => {
        const u = (messages as Array<{ role: string; content: string }>).find((m) => m.role === "user")?.content ?? "";
        const m = u.match(/<form id="(f_[^\"]+)" command="return"/);
        return { content: "", toolCalls: [toolCall("submit", { form_id: m?.[1] ?? "form_unknown", summary: "完成" })] };
      },
    ];

    const config = makeConfig({
      directory: [
        { name: "助手A", whoAmI: "我是助手A", functions: [] },
        { name: "助手B", whoAmI: "我是助手B", functions: [] },
      ],
      steps,
    });
    await runWithThreadTree("test_obj", "你好", "user", config);

    expect(userMsg).toContain("助手A");
    expect(userMsg).toContain("助手B");
  });

  test("traits 的 readme 出现在 Context 中", async () => {
    let systemMsg = "";
    const steps: MockStep[] = [
      (messages: unknown[]) => {
        const sys = (messages as Array<{ role: string; content: string }>).find((m) => m.role === "system");
        if (sys) systemMsg = sys.content;
        return { content: "", toolCalls: [toolCall("open", { type: "command", command: "return", description: "完成" })] };
      },
      (messages: unknown[]) => {
        const u = (messages as Array<{ role: string; content: string }>).find((m) => m.role === "user")?.content ?? "";
        const m = u.match(/<form id="(f_[^\"]+)" command="return"/);
        return { content: "", toolCalls: [toolCall("submit", { form_id: m?.[1] ?? "form_unknown", summary: "完成" })] };
      },
    ];

    const config = makeConfig({
      stone: { ...makeStone("test_obj"), traits: ["my_trait"] },
      traits: [{
        name: "my_trait",
        type: "how_to_think",
        when: "always",
        description: "测试 trait",
        readme: "这是 my_trait 的知识内容",
        methods: [],
        deps: [],
      }],
      steps,
    });
    await runWithThreadTree("test_obj", "你好", "user", config);

    expect(systemMsg).toContain("my_trait");
    expect(systemMsg).toContain("这是 my_trait 的知识内容");
  });
});

/* ========== 返回值 ========== */

describe("返回值", () => {
  test("TalkResult 包含所有必要字段", async () => {
    const config = makeConfig({ steps: scriptReturn("一切顺利") });

    const result = await runWithThreadTree("test_obj", "你好", "user", config);

    expect(result).toHaveProperty("sessionId");
    expect(result).toHaveProperty("status");
    expect(result).toHaveProperty("summary");
    expect(result).toHaveProperty("totalIterations");
    expect(typeof result.sessionId).toBe("string");
    expect(result.sessionId.startsWith("s_")).toBe(true);
  });
});

/* ========== title 参数（阶段 B） ==========
 * 注：title 参数的单元测试放在 thread-engine-title.test.ts（如存在）。
 * 本文件聚焦基础执行路径，不重复覆盖。
 */
