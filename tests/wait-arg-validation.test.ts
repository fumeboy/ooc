/**
 * F1 修复验证测试
 *
 * Bruce 发现：传入字符串 "yes" 而不是布尔值 true，引擎没有报错，
 * 只是静默地不激活 talk.wait 路径，LLM 容易踩坑无法察觉。
 *
 * 修复：在 talk 和 think 的 submit handler 中，
 * 检测 args.wait 为非 boolean 时注入警告 inject。
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

import { runWithThreadTree, type EngineConfig } from "../src/thinkable/engine/engine.js";
import { MockLLMClient, type ToolCall } from "../src/thinkable/client.js";
import type { StoneData } from "../src/types/index.js";
import { eventBus } from "../src/observable/server/events.js";
import type { ThreadAction } from "../src/thinkable/thread-tree/types.js";

const TEST_DIR = join(import.meta.dir, ".tmp_wait_arg_validation_test");
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

/** 读 thread.json 中的 inject actions */
async function readInjectActions(
  flowsDir: string,
  sessionId: string,
  objectName: string,
): Promise<ThreadAction[]> {
  const sessionDir = join(flowsDir, sessionId);
  const threadsJsonPath = join(sessionDir, "objects", objectName, "threads.json");
  const threadsJson = JSON.parse(await Bun.file(threadsJsonPath).text());
  const rootId = threadsJson.rootId as string;
  const threadPath = join(sessionDir, "objects", objectName, "threads", rootId, "thread.json");
  const thread = JSON.parse(await Bun.file(threadPath).text());
  return (thread.actions as ThreadAction[]).filter((a) => a.type === "inject");
}

beforeEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
  mkdirSync(FLOWS_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
  eventBus.removeAllListeners("sse");
});

/* ========================================================================
 * F1: talk submit 中 wait 参数类型校验
 * ======================================================================== */

describe("F1 — talk submit: wait 参数类型校验", () => {
  test("talk submit 传 wait='yes'（字符串）时，注入包含类型警告", async () => {
    let step = 0;
    let talkFormId = "f_unknown";

    const llm = new MockLLMClient({
      responseFn: (messages) => {
        step++;
        const userMsg = (messages as Array<{ role: string; content: string }>)
          .find((m) => m.role === "user");

        if (step === 1) {
          return {
            content: "",
            toolCalls: [toolCall("open", {
              title: "talk",
              type: "command",
              command: "talk",
              description: "发消息",
            })],
          };
        }

        if (step === 2) {
          const m = userMsg?.content.match(/<form id="(f_[^"]+)" command="talk"/);
          if (m?.[1]) talkFormId = m[1];
          /* LLM 错误传了字符串 "yes" 作为 wait */
          return {
            content: "",
            toolCalls: [toolCall("submit", {
              title: "发消息",
              form_id: talkFormId,
              target: "sophia",
              msg: "你好",
              wait: "yes",  // 非 boolean！
            })],
          };
        }

        if (step === 3) {
          return {
            content: "",
            toolCalls: [toolCall("open", {
              title: "完成",
              type: "command",
              command: "return",
              description: "结束",
            })],
          };
        }

        const m = userMsg?.content.match(/<form id="(f_[^"]+)" command="return"/);
        const returnFormId = m?.[1] ?? "f_unknown";
        return {
          content: "",
          toolCalls: [toolCall("submit", {
            title: "完成",
            form_id: returnFormId,
            summary: "done",
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
      onTalk: async () => ({ reply: null, remoteThreadId: "sophia" }),
      schedulerConfig: {
        maxIterationsPerThread: 20,
        maxTotalIterations: 40,
        deadlockGracePeriodMs: 0,
      },
    };

    const result = await runWithThreadTree("alice", "测试 wait 类型校验", "user", config);
    expect(result.status).toBe("done");

    const injects = await readInjectActions(FLOWS_DIR, result.sessionId, "alice");
    const warnInject = injects.find((a) => a.content.includes("wait") && a.content.includes("boolean"));
    expect(warnInject).toBeDefined();
    /* 应说明实际收到的类型 / 值 */
    expect(warnInject!.content).toMatch(/string|yes/);
  });

  test("talk submit 传 wait=true（正确布尔值）时，不注入 wait 类型警告", async () => {
    let step = 0;
    let talkFormId = "f_unknown";

    const llm = new MockLLMClient({
      responseFn: (messages) => {
        step++;
        const userMsg = (messages as Array<{ role: string; content: string }>)
          .find((m) => m.role === "user");

        if (step === 1) {
          return {
            content: "",
            toolCalls: [toolCall("open", {
              title: "talk",
              type: "command",
              command: "talk",
              description: "发消息",
            })],
          };
        }

        if (step === 2) {
          const m = userMsg?.content.match(/<form id="(f_[^"]+)" command="talk"/);
          if (m?.[1]) talkFormId = m[1];
          return {
            content: "",
            toolCalls: [toolCall("submit", {
              title: "发消息",
              form_id: talkFormId,
              target: "sophia",
              msg: "你好",
              wait: true, // 正确的布尔值
            })],
          };
        }

        /* step 3+：等待 sophia 回复，模拟没有回复直接继续 */
        return {
          content: "",
          toolCalls: [toolCall("open", {
            title: "完成",
            type: "command",
            command: "return",
            description: "结束",
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
      stone: makeStone("bob"),
      onTalk: async () => ({ reply: null, remoteThreadId: "sophia" }),
      schedulerConfig: {
        maxIterationsPerThread: 10,
        maxTotalIterations: 20,
        deadlockGracePeriodMs: 0,
      },
    };

    const result = await runWithThreadTree("bob", "测试 wait=true 不触发警告", "user", config);
    /* talk_sync 会进入 waiting，最终超时 failed 也可接受 */
    expect(result.status === "done" || result.status === "waiting" || result.status === "failed").toBe(true);

    const injects = await readInjectActions(FLOWS_DIR, result.sessionId, "bob");
    /* 不应有 wait 类型警告 */
    const warnInject = injects.find(
      (a) => a.content.includes("wait") && a.content.includes("boolean") && a.content.includes("警告"),
    );
    expect(warnInject).toBeUndefined();
  });

  test("talk submit 不传 wait 时，不注入 wait 类型警告", async () => {
    let step = 0;
    let talkFormId = "f_unknown";

    const llm = new MockLLMClient({
      responseFn: (messages) => {
        step++;
        const userMsg = (messages as Array<{ role: string; content: string }>)
          .find((m) => m.role === "user");

        if (step === 1) {
          return {
            content: "",
            toolCalls: [toolCall("open", {
              title: "talk",
              type: "command",
              command: "talk",
              description: "发消息",
            })],
          };
        }

        if (step === 2) {
          const m = userMsg?.content.match(/<form id="(f_[^"]+)" command="talk"/);
          if (m?.[1]) talkFormId = m[1];
          return {
            content: "",
            toolCalls: [toolCall("submit", {
              title: "发消息",
              form_id: talkFormId,
              target: "sophia",
              msg: "你好",
              /* 不传 wait */
            })],
          };
        }

        if (step === 3) {
          return {
            content: "",
            toolCalls: [toolCall("open", {
              title: "完成",
              type: "command",
              command: "return",
              description: "结束",
            })],
          };
        }

        const m = userMsg?.content.match(/<form id="(f_[^"]+)" command="return"/);
        const returnFormId = m?.[1] ?? "f_unknown";
        return {
          content: "",
          toolCalls: [toolCall("submit", {
            title: "完成",
            form_id: returnFormId,
            summary: "done",
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
      stone: makeStone("carol"),
      onTalk: async () => ({ reply: null, remoteThreadId: "sophia" }),
      schedulerConfig: {
        maxIterationsPerThread: 20,
        maxTotalIterations: 40,
        deadlockGracePeriodMs: 0,
      },
    };

    const result = await runWithThreadTree("carol", "测试无 wait 不触发警告", "user", config);
    expect(result.status).toBe("done");

    const injects = await readInjectActions(FLOWS_DIR, result.sessionId, "carol");
    const warnInject = injects.find(
      (a) => a.content.includes("wait") && a.content.includes("boolean") && a.content.includes("警告"),
    );
    expect(warnInject).toBeUndefined();
  });
});

/* ========================================================================
 * F1: think submit 中 wait 参数类型校验
 * ======================================================================== */

describe("F1 — think submit: wait 参数类型校验", () => {
  test("think submit 传 wait=1（数字）时，注入包含类型警告", async () => {
    let step = 0;
    let thinkFormId = "f_unknown";

    const llm = new MockLLMClient({
      responseFn: (messages) => {
        step++;
        const userMsg = (messages as Array<{ role: string; content: string }>)
          .find((m) => m.role === "user");

        if (step === 1) {
          return {
            content: "",
            toolCalls: [toolCall("open", {
              title: "创建子线程",
              type: "command",
              command: "think",
              description: "分析任务",
            })],
          };
        }

        if (step === 2) {
          const m = userMsg?.content.match(/<form id="(f_[^"]+)" command="think"/);
          if (m?.[1]) thinkFormId = m[1];
          return {
            content: "",
            toolCalls: [toolCall("submit", {
              title: "分析",
              form_id: thinkFormId,
              context: "fork",
              msg: "分析 G3",
              wait: 1,  // 数字类型，非 boolean！
            })],
          };
        }

        /* 后续：return */
        if (step === 3) {
          return {
            content: "",
            toolCalls: [toolCall("open", {
              title: "完成",
              type: "command",
              command: "return",
              description: "结束",
            })],
          };
        }

        const m = userMsg?.content.match(/<form id="(f_[^"]+)" command="return"/);
        const returnFormId = m?.[1] ?? "f_unknown";
        return {
          content: "",
          toolCalls: [toolCall("submit", {
            title: "完成",
            form_id: returnFormId,
            summary: "done",
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
      stone: makeStone("dave"),
      schedulerConfig: {
        maxIterationsPerThread: 10,
        maxTotalIterations: 30,
        deadlockGracePeriodMs: 0,
      },
    };

    const result = await runWithThreadTree("dave", "测试 think wait 类型校验", "user", config);
    /* 无论最终状态如何，主要验证 inject */
    expect(result.status === "done" || result.status === "failed").toBe(true);

    const injects = await readInjectActions(FLOWS_DIR, result.sessionId, "dave");
    const warnInject = injects.find((a) => a.content.includes("wait") && a.content.includes("boolean"));
    expect(warnInject).toBeDefined();
    expect(warnInject!.content).toMatch(/number|1/);
  });
});
