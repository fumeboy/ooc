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
import { mkdirSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { runWithThreadTree, type EngineConfig } from "../src/thinkable/engine/engine.js";
import { MockLLMClient, type ToolCall, type MockLLMResponseFnResult } from "../src/thinkable/llm/client.js";
import type { StoneData, DirectoryEntry, TraitDefinition } from "../src/shared/types/index.js";
import { eventBus } from "../src/observable/server/events.js";

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
    const step = steps[i++] ?? steps[steps.length - 1] ?? "";
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
      const allContent = (messages as Array<{ role: string; content: string }>).map((m) => m.content).join("\n");
      /* form_id 形如 f_xxx，active-forms XML：<form id="f_xxx" command="..."> */
      const re = /<form id="(f_[^"]+)" command="([^"]+)"/g;
      let formId = "f_unknown";
      let m: RegExpExecArray | null;
      while ((m = re.exec(allContent ?? "")) !== null) {
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

/** 单步 tool call：plan */
function scriptSetPlan(text: string): MockStep[] {
  return openSubmit("plan", { text });
}

/** 不触发 tool 调用的思考步骤（仅 thinking） */
function scriptThought(content: string): MockStep {
  return content;
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

  test("每个发生 LLM 调用的 thread 都在 thread.json 平级写出最新 llm 文件", async () => {
    let phase = 0;
    const llm = new MockLLMClient({
      responseFn: (messages) => {
        const userContent = (messages as Array<{ role: string; content: string }>).find((m) => m.role === "user")?.content ?? "";
        const isChild = /creator mode="sub_thread"/.test(userContent);

        if (isChild) {
          const m = userContent.match(/<form id="(f_[^"]+)" command="return"/);
          if (m?.[1]) {
            return {
              content: "child-submit-output",
              toolCalls: [toolCall("submit", { form_id: m[1], summary: "child done" })],
            };
          }
          return {
            content: "child-open-output",
            toolCalls: [toolCall("open", { title: "子线程结束", type: "command", command: "return", description: "done" })],
          };
        }

        if (phase === 0) {
          phase = 1;
          return {
            content: "parent-open-do-output",
            toolCalls: [toolCall("open", { title: "父线程派生", type: "command", command: "do", description: "fork child" })],
          };
        }
        if (phase === 1) {
          phase = 2;
          const m = userContent.match(/<form id="(f_[^"]+)" command="do"/);
          return {
            content: "parent-submit-do-output",
            toolCalls: [toolCall("submit", { form_id: m?.[1] ?? "f_unknown", context: "fork", title: "子任务", msg: "处理子任务" })],
          };
        }

        const rm = userContent.match(/<form id="(f_[^"]+)" command="return"/);
        if (rm?.[1]) {
          return {
            content: "parent-submit-return-output",
            toolCalls: [toolCall("submit", { form_id: rm[1], summary: "parent done" })],
          };
        }
        return {
          content: "parent-open-return-output",
          toolCalls: [toolCall("open", { title: "父线程结束", type: "command", command: "return", description: "done" })],
        };
      },
    });
    const config = makeConfig({ steps: [] });
    config.llm = llm;
    config.schedulerConfig = { maxIterationsPerThread: 20, maxTotalIterations: 40, deadlockGracePeriodMs: 0 };

    const result = await runWithThreadTree("test_obj", "派生子任务", "user", config);

    expect(result.status).toBe("done");
    const objectDir = join(FLOWS_DIR, result.sessionId, "objects", "test_obj");
    const threadsJson = JSON.parse(readFileSync(join(objectDir, "threads.json"), "utf-8")) as {
      nodes: Record<string, { parentId?: string }>;
    };
    const nodes = Object.entries(threadsJson.nodes);
    expect(nodes.length).toBeGreaterThan(1);

    for (const [threadId] of nodes) {
      const ancestorPath: string[] = [];
      let cur: string | undefined = threadId;
      while (cur) {
        ancestorPath.unshift(cur);
        cur = threadsJson.nodes[cur]?.parentId;
      }
      const threadDir = join(objectDir, "threads", ...ancestorPath);
      expect(existsSync(join(threadDir, "thread.json"))).toBe(true);
      expect(existsSync(join(threadDir, "llm.input.txt"))).toBe(true);
      expect(existsSync(join(threadDir, "llm.output.txt"))).toBe(true);
      expect(readFileSync(join(threadDir, "llm.input.txt"), "utf-8")).toContain("<system>");
      expect(readFileSync(join(threadDir, "llm.output.txt"), "utf-8").length).toBeGreaterThan(0);
    }
  });

  test("初始消息被写入 Root 线程的 inbox", async () => {
    let receivedInbox = false;
    const steps: MockStep[] = [
      (messages: unknown[]) => {
        const allContent = (messages as Array<{ role: string; content: string }>).map((m) => m.content).join("\n");
        if (allContent.includes("你好世界")) {
          receivedInbox = true;
        }
        return { content: "", toolCalls: [toolCall("open", { type: "command", command: "return", description: "完成" })] };
      },
      (messages: unknown[]) => {
        const allContent = (messages as Array<{ role: string; content: string }>).map((m) => m.content).join("\n");
        const m = allContent.match(/<form id="(f_[^\"]+)" command="return"/);
        return { content: "", toolCalls: [toolCall("submit", { form_id: m?.[1] ?? "form_unknown", summary: "收到消息" })] };
      },
    ];

    const config = makeConfig({ steps });
    await runWithThreadTree("test_obj", "你好世界", "user", config);

    expect(receivedInbox).toBe(true);
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
        const allContent = (messages as Array<{ role: string; content: string }>).map((m) => m.content).join("\n");
        /* inbox 消息在 context 中形如 <message id="msg_xxx" from="user" status="unread"> */
        if (/id="msg_[^"]+"\s+from="user"\s+status="unread"/.test(allContent)) {
          firstCallSawInboxId = true;
        }
        return { content: "", toolCalls: [toolCall("open", { type: "command", command: "talk", description: "回复 user" })] };
      },
      /* 轮 2: submit talk */
      (messages: unknown[]) => {
        const allContent = (messages as Array<{ role: string; content: string }>).map((m) => m.content).join("\n");
        const m = allContent.match(/<form id="(f_[^\"]+)" command="talk"/);
        return { content: "", toolCalls: [toolCall("submit", { form_id: m?.[1] ?? "form_unknown", target: "user", message: "收到" })] };
      },
      /* 轮 3: open return */
      (messages: unknown[]) => {
        stage++;
        const allContent = (messages as Array<{ role: string; content: string }>).map((m) => m.content).join("\n");
        /* stage >= 3 时检查：inbox 应该已被 ack */
        if (allContent.includes("未读消息")) {
          laterCallHasInbox = true;
        }
        return { content: "", toolCalls: [toolCall("open", { type: "command", command: "return", description: "结束" })] };
      },
      /* 轮 4: submit return */
      (messages: unknown[]) => {
        const allContent = (messages as Array<{ role: string; content: string }>).map((m) => m.content).join("\n");
        const m = allContent.match(/<form id="(f_[^\"]+)" command="return"/);
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
  test("plan 更新后在下一轮 Context 中可见", async () => {
    let planVisibleLater = false;

    const steps: MockStep[] = [
      /* 轮 1: open plan */
      ...openSubmit("plan", { text: "第一步：分析需求" }),
      /* 轮 3: 检查 plan 是否在 context 中；此时再 open return */
      (messages: unknown[]) => {
        const allContent = (messages as Array<{ role: string; content: string }>).map((m) => m.content).join("\n");
        if (allContent.includes("第一步：分析需求")) {
          planVisibleLater = true;
        }
        return { content: "", toolCalls: [toolCall("open", { type: "command", command: "return", description: "结束" })] };
      },
      /* 轮 4: submit return */
      (messages: unknown[]) => {
        const allContent = (messages as Array<{ role: string; content: string }>).map((m) => m.content).join("\n");
        const m = allContent.match(/<form id="(f_[^\"]+)" command="return"/);
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
    expect(endEvents[0]?.status).toBe("finished");
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

  test("失败时 flow:end 状态为 failed", async () => {
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
    expect(endEvents[0]?.status).toBe("failed");
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

    expect(result.status).toBe("failed");
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
        const allContent = (messages as Array<{ role: string; content: string }>).map((m) => m.content).join("\n");
        const m = allContent.match(/<form id="(f_[^\"]+)" command="return"/);
        return { content: "", toolCalls: [toolCall("submit", { form_id: m?.[1] ?? "form_unknown", summary: "完成" })] };
      },
    ];

    const config = makeConfig({ stone: makeStone("哲学家"), steps });
    await runWithThreadTree("哲学家", "你好", "user", config);

    expect(systemMsg).toContain("哲学家");
    expect(systemMsg).toContain("我是 哲学家");
  });

  test("directory 中的对象出现在 system context 中", async () => {
    let contextMsg = "";
    const steps: MockStep[] = [
      (messages: unknown[]) => {
        const sys = (messages as Array<{ role: string; content: string }>).find((m) => m.role === "system");
        if (sys) contextMsg = sys.content;
        return { content: "", toolCalls: [toolCall("open", { type: "command", command: "return", description: "完成" })] };
      },
      (messages: unknown[]) => {
        const allContent = (messages as Array<{ role: string; content: string }>).map((m) => m.content).join("\n");
        const m = allContent.match(/<form id="(f_[^\"]+)" command="return"/);
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

    expect(contextMsg).toContain("助手A");
    expect(contextMsg).toContain("助手B");
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
      stone: {
        ...makeStone("test_obj"),
        data: { _traits_ref: ["kernel:my_trait"] },
      },
      traits: [{
        namespace: "kernel",
        kind: "trait",
        name: "my_trait",
        type: "how_to_think",
        description: "测试 trait",
        readme: "这是 my_trait 的知识内容",
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
