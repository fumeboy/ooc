/**
 * 线程树执行引擎测试
 *
 * 使用 mock LLM 验证 engine 的完整执行流程：
 * - 单轮对话（thought → return）
 * - 多轮迭代（thought → program → return）
 * - 子线程创建与调度
 * - 错误处理
 * - SSE 事件发射
 *
 * @ref docs/superpowers/specs/2026-04-06-thread-tree-architecture-design.md
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";

import { runWithThreadTree, type EngineConfig, type TalkResult } from "../src/thread/engine.js";
import { MockLLMClient } from "../src/thinkable/client.js";
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

/** 创建基础 EngineConfig */
function makeConfig(overrides?: {
  responses?: string[];
  responseFn?: (messages: any[]) => string;
  stone?: StoneData;
  directory?: DirectoryEntry[];
  traits?: TraitDefinition[];
  schedulerConfig?: EngineConfig["schedulerConfig"];
  onTalk?: EngineConfig["onTalk"];
}): EngineConfig {
  const llm = overrides?.responseFn
    ? new MockLLMClient({ responseFn: overrides.responseFn })
    : new MockLLMClient({ responses: overrides?.responses ?? [] });

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

/** 生成 talk 的 TOML */
function tomlTalk(target: string, message: string, extra?: string): string {
  return `[talk]\ntarget = "${target}"\nmessage = "${message}"${extra ? `\n${extra}` : ""}`;
}

/** 生成 return 指令的 TOML */
function tomlReturn(summary: string): string {
  return `[return]\nsummary = "${summary}"`;
}

/** 生成 thought + return 的 TOML */
function tomlThoughtReturn(thought: string, summary: string): string {
  return `[thought]\ncontent = "${thought}"\n\n[return]\nsummary = "${summary}"`;
}

/** 生成 create_sub_thread 的 TOML */
function tomlCreateSubThread(title: string, description?: string): string {
  let toml = `[create_sub_thread]\ntitle = "${title}"`;
  if (description) toml += `\ndescription = "${description}"`;
  return toml;
}

/** 生成 thought 的 TOML */
function tomlThought(content: string): string {
  return `[thought]\ncontent = "${content}"`;
}

/** 生成 set_plan 的 TOML */
function tomlSetPlan(text: string): string {
  return `[set_plan]\ntext = "${text}"`;
}

/** 生成 await 的 TOML */
function tomlAwait(threadId: string): string {
  return `[await]\nthread_id = "${threadId}"`;
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
  test("单轮对话：thought → return → done", async () => {
    const config = makeConfig({
      responses: [tomlThoughtReturn("我在思考", "任务完成")],
    });

    const result = await runWithThreadTree("test_obj", "你好", "user", config);

    expect(result.status).toBe("done");
    expect(result.summary).toBe("任务完成");
    expect(result.sessionId).toBeTruthy();
    expect(result.totalIterations).toBe(1);
  });

  test("多轮迭代：thought → thought → return", async () => {
    let callCount = 0;
    const config = makeConfig({
      responseFn: () => {
        callCount++;
        if (callCount < 3) {
          return tomlThought(`第 ${callCount} 轮思考`);
        }
        return tomlReturn("经过三轮思考完成");
      },
    });

    const result = await runWithThreadTree("test_obj", "复杂任务", "user", config);

    expect(result.status).toBe("done");
    expect(result.summary).toBe("经过三轮思考完成");
    expect(result.totalIterations).toBe(3);
  });

  test("session 目录被正确创建", async () => {
    const config = makeConfig({
      responses: [tomlReturn("完成")],
    });

    const result = await runWithThreadTree("test_obj", "你好", "user", config);

    const sessionDir = join(FLOWS_DIR, result.sessionId);
    expect(existsSync(sessionDir)).toBe(true);

    const objectDir = join(sessionDir, "objects", "test_obj");
    expect(existsSync(objectDir)).toBe(true);
  });

  test("初始消息被写入 Root 线程的 inbox", async () => {
    let receivedInbox = false;
    const config = makeConfig({
      responseFn: (messages: any[]) => {
        /* 检查 user message 中是否包含初始消息 */
        const userMsg = messages.find((m: any) => m.role === "user");
        if (userMsg && userMsg.content.includes("你好世界")) {
          receivedInbox = true;
        }
        return tomlReturn("收到消息");
      },
    });

    await runWithThreadTree("test_obj", "你好世界", "user", config);

    expect(receivedInbox).toBe(true);
  });
});

describe("talk 自动 ack 兜底", () => {
  test("仅当 target 只有一条未读且为最新消息，且 talk 未显式 mark 时自动 ack", async () => {
    let callCount = 0;
    let firstCallSawInboxId = false;
    let secondCallHasInbox = false;

    const config = makeConfig({
      onTalk: async () => null,
      responseFn: (messages: any[]) => {
        callCount++;
        const userMsg = messages.find((m: any) => m.role === "user")?.content ?? "";

        if (callCount === 1) {
          // 第一次应能看到未读消息行（含 #msg_ 前缀）
          if (userMsg.includes("## 未读消息") && userMsg.includes("#msg_")) {
            firstCallSawInboxId = true;
          }
          // 输出 talk（不带 mark），触发引擎兜底
          return tomlTalk("user", "收到");
        }

        // 第二次：如果兜底 ack 生效，则不会再出现未读消息块
        if (userMsg.includes("## 未读消息")) {
          secondCallHasInbox = true;
        }
        return tomlReturn("done");
      },
    });

    const result = await runWithThreadTree("test_obj", "hi", "user", config);
    expect(result.status).toBe("done");
    expect(callCount).toBe(2);
    expect(firstCallSawInboxId).toBe(true);
    expect(secondCallHasInbox).toBe(false);

    // 读取落盘 thread.json，确认 inbox 状态已被标记
    const sessionDir = join(FLOWS_DIR, result.sessionId);
    const threadsJsonPath = join(sessionDir, "objects", "test_obj", "threads.json");
    const threadsJson = JSON.parse(await Bun.file(threadsJsonPath).text());
    const rootId = threadsJson.rootId as string;
    const threadPath = join(sessionDir, "objects", "test_obj", "threads", rootId, "thread.json");
    const thread = JSON.parse(await Bun.file(threadPath).text());
    const inbox = thread.inbox as any[];
    expect(Array.isArray(inbox)).toBe(true);
    const marked = inbox.find((m) => m.status === "marked");
    expect(marked).toBeTruthy();
    expect(marked.mark?.type).toBe("ack");
  });
});

/* ========== 计划更新 ========== */

describe("计划更新", () => {
  test("set_plan 更新后在下一轮 Context 中可见", async () => {
    let callCount = 0;
    let planVisible = false;
    const config = makeConfig({
      responseFn: (messages: any[]) => {
        callCount++;
        if (callCount === 1) {
          return tomlSetPlan("第一步：分析需求");
        }
        if (callCount === 2) {
          const userMsg = messages.find((m: any) => m.role === "user");
          if (userMsg && userMsg.content.includes("第一步：分析需求")) {
            planVisible = true;
          }
          return tomlReturn("计划执行完毕");
        }
        return tomlReturn("done");
      },
    });

    const result = await runWithThreadTree("test_obj", "制定计划", "user", config);

    expect(result.status).toBe("done");
    expect(planVisible).toBe(true);
  });
});

/* ========== 安全阀 ========== */

describe("安全阀", () => {
  test("单线程迭代上限 → failed", async () => {
    const config = makeConfig({
      responseFn: () => tomlThought("无限思考"),
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
      responseFn: () => tomlThought("无限思考"),
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
    const events: any[] = [];
    eventBus.on("sse", (e: any) => events.push(e));

    const config = makeConfig({
      responses: [tomlReturn("完成")],
    });

    await runWithThreadTree("test_obj", "你好", "user", config);

    const startEvents = events.filter(e => e.type === "flow:start");
    const endEvents = events.filter(e => e.type === "flow:end");

    expect(startEvents.length).toBe(1);
    expect(startEvents[0].objectName).toBe("test_obj");

    expect(endEvents.length).toBe(1);
    expect(endEvents[0].objectName).toBe("test_obj");
    expect(endEvents[0].status).toBe("idle");
  });

  test("发射 flow:progress 事件", async () => {
    const events: any[] = [];
    eventBus.on("sse", (e: any) => events.push(e));

    const config = makeConfig({
      responses: [tomlReturn("完成")],
    });

    await runWithThreadTree("test_obj", "你好", "user", config);

    const progressEvents = events.filter(e => e.type === "flow:progress");
    expect(progressEvents.length).toBeGreaterThanOrEqual(1);
    expect(progressEvents[0].iterations).toBe(1);
  });

  test("失败时 flow:end 状态为 error", async () => {
    const events: any[] = [];
    eventBus.on("sse", (e: any) => events.push(e));

    const config = makeConfig({
      responseFn: () => tomlThought("无限"),
      schedulerConfig: {
        maxIterationsPerThread: 2,
        maxTotalIterations: 100,
        deadlockGracePeriodMs: 0,
      },
    });

    await runWithThreadTree("test_obj", "失败任务", "user", config);

    const endEvents = events.filter(e => e.type === "flow:end");
    expect(endEvents.length).toBe(1);
    expect(endEvents[0].status).toBe("error");
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
        return tomlReturn("不应到达");
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
    let callCount = 0;
    const config = makeConfig({
      responseFn: () => {
        callCount++;
        if (callCount <= 2) return ""; /* 空输出 */
        return tomlReturn("最终完成");
      },
    });

    const result = await runWithThreadTree("test_obj", "你好", "user", config);

    expect(result.status).toBe("done");
    expect(result.totalIterations).toBe(3);
  });
});

/* ========== 暂停 ========== */

describe("暂停", () => {
  test("isPaused 为 true → 不执行迭代", async () => {
    let iterCount = 0;
    const config = makeConfig({
      responseFn: () => {
        iterCount++;
        return tomlReturn("不应到达");
      },
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
    const config = makeConfig({
      stone: makeStone("哲学家"),
      responseFn: (messages: any[]) => {
        const sys = messages.find((m: any) => m.role === "system");
        if (sys) systemMsg = sys.content;
        return tomlReturn("完成");
      },
    });

    await runWithThreadTree("哲学家", "你好", "user", config);

    expect(systemMsg).toContain("哲学家");
    expect(systemMsg).toContain("我是 哲学家");
  });

  test("directory 中的对象出现在 user message 中", async () => {
    let userMsg = "";
    const config = makeConfig({
      directory: [
        { name: "助手A", whoAmI: "我是助手A", functions: [] },
        { name: "助手B", whoAmI: "我是助手B", functions: [] },
      ],
      responseFn: (messages: any[]) => {
        const u = messages.find((m: any) => m.role === "user");
        if (u) userMsg = u.content;
        return tomlReturn("完成");
      },
    });

    await runWithThreadTree("test_obj", "你好", "user", config);

    expect(userMsg).toContain("助手A");
    expect(userMsg).toContain("助手B");
  });

  test("traits 的 readme 出现在 Context 中", async () => {
    let systemMsg = "";
    const config = makeConfig({
      stone: {
        ...makeStone("test_obj"),
        traits: ["my_trait"],
      },
      traits: [{
        name: "my_trait",
        type: "how_to_think",
        when: "always",
        description: "测试 trait",
        readme: "这是 my_trait 的知识内容",
        methods: [],
        deps: [],
      }],
      responseFn: (messages: any[]) => {
        const sys = messages.find((m: any) => m.role === "system");
        if (sys) systemMsg = sys.content;
        return tomlReturn("完成");
      },
    });

    await runWithThreadTree("test_obj", "你好", "user", config);

    expect(systemMsg).toContain("my_trait");
    expect(systemMsg).toContain("这是 my_trait 的知识内容");
  });
});

/* ========== 返回值 ========== */

describe("返回值", () => {
  test("TalkResult 包含所有必要字段", async () => {
    const config = makeConfig({
      responses: [tomlReturn("一切顺利")],
    });

    const result = await runWithThreadTree("test_obj", "你好", "user", config);

    expect(result).toHaveProperty("sessionId");
    expect(result).toHaveProperty("status");
    expect(result).toHaveProperty("summary");
    expect(result).toHaveProperty("totalIterations");
    expect(typeof result.sessionId).toBe("string");
    expect(result.sessionId.startsWith("s_")).toBe(true);
  });
});
