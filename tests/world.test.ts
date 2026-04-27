/**
 * World 集成测试
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { World } from "../src/world/index.js";
import { MockLLMClient, type ToolCall } from "../src/thinkable/llm/client.js";
import type { LLMConfig } from "../src/thinkable/llm/config.js";
import { eventBus } from "../src/observable/server/events.js";

const TEST_DIR = join(import.meta.dir, ".tmp_world_test");

/**
 * 测试用 LLMConfig：不依赖 OOC_API_KEY 环境变量。
 * World 构造时会传给 OpenAICompatibleClient，但测试里从未真正调用 chat API
 * （要么只构造 World / createObject，要么 mock 掉 _llm）。
 */
const TEST_LLM_CONFIG: LLMConfig = {
  provider: "openai-compatible",
  apiKey: "test-key",
  baseUrl: "https://example.invalid/v1",
  model: "test-model",
  maxTokens: 1024,
  timeout: 5,
};

beforeEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("World", () => {
  test("初始化创建目录结构", () => {
    const world = new World({ rootDir: TEST_DIR, llmConfig: TEST_LLM_CONFIG });
    world.init();

    const { existsSync } = require("node:fs");
    expect(existsSync(join(TEST_DIR, "readme.md"))).toBe(true);
    expect(existsSync(join(TEST_DIR, "data.json"))).toBe(true);
    expect(existsSync(join(TEST_DIR, "stones"))).toBe(true);
    expect(existsSync(join(TEST_DIR, "flows"))).toBe(true);
    expect(existsSync(join(TEST_DIR, "kernel", "traits", "computable", "readme.md"))).toBe(true);
    expect(existsSync(join(TEST_DIR, "kernel", "traits", "talkable", "readme.md"))).toBe(true);
    /* user 对象自动创建（G1: 人类也是对象） */
    expect(existsSync(join(TEST_DIR, "stones", "user", "readme.md"))).toBe(true);
  });

  test("创建对象", () => {
    const world = new World({ rootDir: TEST_DIR, llmConfig: TEST_LLM_CONFIG });
    world.init();

    const stone = world.createObject("greeter", "你是一个友好的问候者");
    expect(stone.name).toBe("greeter");
    expect(stone.thinkable.whoAmI).toBe("你是一个友好的问候者");
  });

  test("列出对象", () => {
    const world = new World({ rootDir: TEST_DIR, llmConfig: TEST_LLM_CONFIG });
    world.init();

    world.createObject("alpha", "Alpha");
    world.createObject("beta", "Beta");

    const objects = world.listObjects();
    /* user + alpha + beta = 3 */
    expect(objects).toHaveLength(3);
    expect(objects.map((o) => o.name).sort()).toEqual(["alpha", "beta", "user"]);
  });

  test("获取对象", () => {
    const world = new World({ rootDir: TEST_DIR, llmConfig: TEST_LLM_CONFIG });
    world.init();

    world.createObject("test", "Test");
    const found = world.getObject("test");
    expect(found).not.toBeUndefined();
    expect(found!.name).toBe("test");

    const notFound = world.getObject("nonexistent");
    expect(notFound).toBeUndefined();
  });

  test("重复创建对象抛出错误", () => {
    const world = new World({ rootDir: TEST_DIR, llmConfig: TEST_LLM_CONFIG });
    world.init();

    world.createObject("unique", "Unique");
    expect(() => world.createObject("unique", "Duplicate")).toThrow();
  });

  test("重启后加载已有对象", () => {
    /* 第一次启动，创建对象 */
    const world1 = new World({ rootDir: TEST_DIR, llmConfig: TEST_LLM_CONFIG });
    world1.init();
    world1.createObject("persistent", "我会被记住");

    /* 第二次启动 */
    const world2 = new World({ rootDir: TEST_DIR, llmConfig: TEST_LLM_CONFIG });
    world2.init();

    const objects = world2.listObjects();
    /* user + persistent = 2 */
    expect(objects).toHaveLength(2);
    expect(objects.map((o) => o.name).sort()).toEqual(["persistent", "user"]);
  });

  test("线程树：talk(user) 只投递消息，不触发 user thinkloop", async () => {
    const events: any[] = [];
    const onSse = (e: any) => events.push(e);
    eventBus.on("sse", onSse);

    try {
      const world = new World({ rootDir: TEST_DIR, llmConfig: TEST_LLM_CONFIG });
      world.init();
      world.createObject("supervisor", "你是一个测试 supervisor");

      /**
       * 注入 mock LLM：用 tool-calling 协议驱动一次 talk→user + 一次 return。
       * phase 0: open(talk)  → phase 1: submit(talk to user)
       * phase 2: open(return) → phase 3: submit(return)
       */
      const toolCall = (name: string, args: Record<string, unknown>): ToolCall => ({
        id: `tc_${Math.random().toString(36).slice(2, 8)}`,
        type: "function",
        function: { name, arguments: JSON.stringify(args) },
      });

      let phase = 0;
      (world as any)._llm = new MockLLMClient({
        responseFn: (messages: unknown[]) => {
          const userContent = (messages as Array<{ role: string; content: string }>).find((m) => m.role === "user")?.content ?? "";
          const talkForm = userContent.match(/<form id="(f_[^"]+)" command="talk"/);
          const retForm = userContent.match(/<form id="(f_[^"]+)" command="return"/);
          if (phase === 0) { phase = 1; return { content: "", toolCalls: [toolCall("open", { title: "准备 talk user", type: "command", command: "talk", description: "向 user 发招呼" })] }; }
          if (phase === 1 && talkForm?.[1]) { phase = 2; return { content: "", toolCalls: [toolCall("submit", { title: "向 user 问好", form_id: talkForm[1], target: "user", message: "你好" })] }; }
          if (phase === 2) { phase = 3; return { content: "", toolCalls: [toolCall("open", { title: "准备 return", type: "command", command: "return", description: "结束" })] }; }
          if (phase === 3 && retForm?.[1]) { return { content: "", toolCalls: [toolCall("submit", { title: "返回 done", form_id: retForm[1], summary: "done" })] }; }
          return { content: "", toolCalls: [toolCall("open", { title: "兜底 return", type: "command", command: "return", description: "结束" })] };
        },
      });

      // 防回归：如果仍然会调度 user，会触发这里的 throw
      const originalTalkWithThreadTree = (world as any)._talkWithThreadTree.bind(world);
      (world as any)._talkWithThreadTree = async (objectName: string, message: string, from: string) => {
        const lower = (objectName ?? "").toLowerCase();
        if (lower === "user" || lower === "human") {
          throw new Error("BUG: user/human 不应触发线程树执行");
        }
        return originalTalkWithThreadTree(objectName, message, from);
      };

      await world.talk("supervisor", "hi", "human");

      // 断言：收到一条从 supervisor 发往 user 的 SSE 消息（无需 user 回复）
      const msgEvents = events.filter(e => e.type === "flow:message");
      expect(msgEvents.length).toBeGreaterThan(0);
      const hasUserMsg = msgEvents.some(e => e.message?.direction === "out" && e.message?.from === "supervisor" && e.message?.to === "user" && e.message?.content === "你好");
      expect(hasUserMsg).toBe(true);
    } finally {
      eventBus.off("sse", onSse);
    }
  });
});
