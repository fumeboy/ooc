/**
 * engine.runSuperThread 集成测试（Phase 3）
 *
 * 目标：验证 super 线程执行路径能：
 * 1. 从 `stones/{name}/super/` 加载 ThreadsTree（非 flows/ 路径）
 * 2. 消费 unread inbox（LLM 走 ThinkLoop → mark 为 ack）
 * 3. persist_to_memory 写入 `stones/{name}/memory.md`
 * 4. 执行后 inbox 状态正确变化（unread → marked）
 *
 * 路径绕过：用 MockLLMClient 脚本化 tool_call，不依赖真实 LLM。
 * super trait 的 `persist_to_memory` 方法被 registerAll 注入后，LLM 通过
 * `program` trait/method 调用写入 memory.md——验证完整的 G12 沉淀链路。
 *
 * @ref kernel/src/collaborable/super/super-thread.ts — runSuperThread
 * @ref kernel/traits/reflective/super/index.ts — persist_to_memory
 * @ref docs/工程管理/迭代/all/20260422_feature_super_scheduler.md
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { type EngineConfig } from "../src/thread/engine.js";
import { runSuperThread } from "../src/collaborable/super/super-thread.js";
import { MockLLMClient, type ToolCall, type MockLLMResponseFnResult } from "../src/thinkable/client.js";
import type { StoneData, TraitDefinition } from "../src/types/index.js";
import { handleOnTalkToSuper } from "../src/collaborable/super/super.js";
import { llm_methods as superLLMMethods } from "../../kernel/traits/reflective/super/index.js";
import { eventBus } from "../src/observable/server/events.js";

function makeTmpRoot(prefix = "engine-run-super-test"): string {
  const base = join(tmpdir(), `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(base, { recursive: true });
  return base;
}

function toolCall(name: string, args: Record<string, unknown>): ToolCall {
  return {
    id: `tc_${Math.random().toString(36).slice(2, 8)}`,
    type: "function",
    function: { name, arguments: JSON.stringify(args) },
  };
}

function makeStone(name: string): StoneData {
  return {
    name,
    thinkable: { whoAmI: `${name} stone` },
    talkable: { whoAmI: `${name} stone`, functions: [] },
    data: {},
    relations: [],
    traits: [],
  };
}

/** 构造含 `reflective/super` trait 的 traits 列表，让 program trait/method 能调 persist_to_memory
 *
 * 注意：Trait 定义内部用驼峰 `llmMethods`（loader 把 `llm_methods` 转换过来）；
 * 手动构造时也必须用 `llmMethods`，否则 registerAll 找不到方法。
 */
function makeSuperTrait(): TraitDefinition {
  return {
    namespace: "kernel",
    name: "reflective/super",
    type: "how_to_think",
    description: "super 沉淀工具集",
    deps: [],
    readme: "",
    dir: "",
    llmMethods: superLLMMethods,
    uiMethods: {},
    /* 填充其他必要字段 */
    active: true,
  } as unknown as TraitDefinition;
}

describe("engine.runSuperThread", () => {
  let rootDir: string;
  let stoneDir: string;
  let superDir: string;

  beforeEach(() => {
    rootDir = makeTmpRoot();
    stoneDir = join(rootDir, "stones", "bruce");
    mkdirSync(stoneDir, { recursive: true });
    superDir = join(stoneDir, "super");
  });

  afterEach(() => {
    if (existsSync(rootDir)) rmSync(rootDir, { recursive: true, force: true });
    eventBus.removeAllListeners("sse");
  });

  test("super 线程消费 unread inbox → LLM 调 persist_to_memory → memory.md 落盘 + inbox ack", async () => {
    /* 1. 先往 super inbox 投一条消息（模拟 bruce talk(super, "记下 X")） */
    await handleOnTalkToSuper({
      fromObject: "bruce",
      message: "沉淀：线程树让注意力边界可见",
      rootDir,
    });
    /* 验证前置条件 */
    const threadsJsonBefore = JSON.parse(readFileSync(join(superDir, "threads.json"), "utf-8"));
    const rootId = threadsJsonBefore.rootId;
    const threadJsonPath = join(superDir, "threads", rootId, "thread.json");
    const beforeData = JSON.parse(readFileSync(threadJsonPath, "utf-8"));
    expect(beforeData.inbox[0].status).toBe("unread");

    /* 2. 构造 mock LLM 脚本：
       - 第一轮：open program（trait=reflective/super, method=persist_to_memory）
       - 第二轮：submit 该 form，args 含 key/content + 同时把 inbox 消息 mark=ack
       - 第三轮：open return
       - 第四轮：submit return */
    let formId = "";
    let step = 0;
    const llm = new MockLLMClient({
      responseFn: (messages: unknown[]): MockLLMResponseFnResult => {
        step++;
        if (step === 1) {
          /* open program trait/method */
          return {
            content: "",
            toolCalls: [toolCall("open", {
              type: "command",
              command: "program",
              /* engine 内部按 traitName 完整匹配（"kernel:reflective/super"），
               * LLM 在生产中也可以省略 namespace；测试里直接传完整 id 简化路径。 */
              trait: "kernel:reflective/super",
              method: "persist_to_memory",
              description: "沉淀一条经验到 memory.md",
            })],
          };
        }
        if (step === 2) {
          /* 从 user message 里找 form id + inbox message id */
          const userMsg = (messages as Array<{ role: string; content: string }>).find((m) => m.role === "user");
          const fmMatch = /<form id="(f_[^"]+)" command="program"/.exec(userMsg?.content ?? "");
          formId = fmMatch ? fmMatch[1]! : "f_unknown";
          const msgIdMatch = /<message id="([^"]+)" from="bruce" status="unread"/.exec(userMsg?.content ?? "");
          const messageId = msgIdMatch ? msgIdMatch[1]! : "msg_unknown";
          return {
            content: "",
            toolCalls: [toolCall("submit", {
              form_id: formId,
              args: {
                key: "线程树让注意力可见",
                content: "线程树的设计第一次让外部观察者看到 LLM 的注意力边界。",
              },
              mark: [{ messageId, type: "ack", tip: "已沉淀" }],
            })],
          };
        }
        if (step === 3) {
          return {
            content: "",
            toolCalls: [toolCall("open", { type: "command", command: "return", description: "结束一轮反思" })],
          };
        }
        /* step 4: submit return */
        const userMsg = (messages as Array<{ role: string; content: string }>).find((m) => m.role === "user");
        const fmMatch = /<form id="(f_[^"]+)" command="return"/.exec(userMsg?.content ?? "");
        const returnFormId = fmMatch ? fmMatch[1]! : "f_unknown";
        return {
          content: "",
          toolCalls: [toolCall("submit", {
            form_id: returnFormId,
            summary: "本轮沉淀已完成",
          })],
        };
      },
    });

    const traits = [makeSuperTrait()];
    const config: EngineConfig = {
      rootDir,
      flowsDir: join(rootDir, "flows"),
      llm,
      directory: [],
      traits,
      stone: makeStone("bruce"),
      paths: {
        stoneDir,
        rootDir,
        flowsDir: join(rootDir, "flows"),
      },
      schedulerConfig: {
        maxIterationsPerThread: 10,
        maxTotalIterations: 30,
        deadlockGracePeriodMs: 0,
      },
    };

    /* 3. 执行 super 线程 */
    const result = await runSuperThread("bruce", superDir, config);

    /* 4. 验证：memory.md 已生成 */
    const memoryPath = join(stoneDir, "memory.md");
    expect(existsSync(memoryPath)).toBe(true);
    const memoryContent = readFileSync(memoryPath, "utf-8");
    expect(memoryContent).toContain("线程树让注意力可见");
    expect(memoryContent).toContain("外部观察者看到 LLM 的注意力边界");

    /* 5. 验证：inbox 消息已被 mark（ack） */
    const afterData = JSON.parse(readFileSync(threadJsonPath, "utf-8"));
    expect(afterData.inbox[0].status).toBe("marked");
    expect(afterData.inbox[0].mark?.type).toBe("ack");

    /* 6. 验证：线程状态 done + 虚拟 sessionId 正确 */
    expect(result.status).toBe("done");
    expect(result.sessionId).toBe("super:bruce");

    /* 7. 验证：不写 flows/ 目录（super 不产生 flows 数据） */
    const flowsDir = join(rootDir, "flows");
    /* 允许 flowsDir 不存在或者为空 */
    if (existsSync(flowsDir)) {
      const { readdirSync } = await import("node:fs");
      const entries = readdirSync(flowsDir);
      /* runSuperThread 本身不写 flows/；SSE 事件是纯内存的 */
      expect(entries.filter(e => !e.startsWith("."))).toEqual([]);
    }
  });

  test("super 线程无 unread inbox → scheduler 跑完无副作用", async () => {
    /* 构造一个空 super（线程存在，inbox 无 unread） */
    const { ThreadsTree } = await import("../src/thread/tree.js");
    mkdirSync(superDir, { recursive: true });
    await ThreadsTree.create(superDir, "bruce:super", "test");

    /* scheduler 会看到 root 线程 status=running 但 inbox 空——LLM 可能被调用一次，
       决定 return。我们用最小 mock：立即 return。 */
    let step = 0;
    const llm = new MockLLMClient({
      responseFn: (messages: unknown[]): MockLLMResponseFnResult => {
        step++;
        if (step === 1) {
          return {
            content: "",
            toolCalls: [toolCall("open", { type: "command", command: "return", description: "无事可做" })],
          };
        }
        const userMsg = (messages as Array<{ role: string; content: string }>).find((m) => m.role === "user");
        const fmMatch = /<form id="(f_[^"]+)" command="return"/.exec(userMsg?.content ?? "");
        const returnFormId = fmMatch ? fmMatch[1]! : "f_unknown";
        return {
          content: "",
          toolCalls: [toolCall("submit", { form_id: returnFormId, summary: "无事" })],
        };
      },
    });

    const config: EngineConfig = {
      rootDir,
      flowsDir: join(rootDir, "flows"),
      llm,
      directory: [],
      traits: [],
      stone: makeStone("bruce"),
      paths: { stoneDir, rootDir, flowsDir: join(rootDir, "flows") },
      schedulerConfig: {
        maxIterationsPerThread: 5,
        maxTotalIterations: 10,
        deadlockGracePeriodMs: 0,
      },
    };

    const result = await runSuperThread("bruce", superDir, config);
    expect(result.status).toBe("done");
    expect(result.sessionId).toBe("super:bruce");

    /* 无 memory.md 产出（没人调 persist） */
    expect(existsSync(join(stoneDir, "memory.md"))).toBe(false);
  });
});
