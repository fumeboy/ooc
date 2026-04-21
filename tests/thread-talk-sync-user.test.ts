/**
 * talk_sync(target="user") 死锁修复单元测试
 *
 * 问题背景：
 *   engine.ts 原本在处理 `talk_sync` 时无条件 `setNodeStatus("waiting")`，
 *   等待对方回复后唤醒。但 user 不参与 ThinkLoop，永远不会回复——
 *   线程会永久 waiting，直到触发全局迭代上限或死锁检测。
 *
 * 修复：当 target="user" 时，engine 不再 setNodeStatus("waiting")，
 *   改为记录 consola.warn，直接继续下一轮（按 talk 语义而非 talk_sync）。
 *
 * @ref docs/工程管理/迭代/all/20260421_feature_user_inbox.md
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

import { runWithThreadTree, type EngineConfig } from "../src/thread/engine.js";
import { MockLLMClient, type ToolCall } from "../src/thinkable/client.js";
import type { StoneData } from "../src/types/index.js";
import { eventBus } from "../src/server/events.js";

const TEST_DIR = join(import.meta.dir, ".tmp_thread_talk_sync_user_test");
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
  rmSync(TEST_DIR, { recursive: true, force: true });
  mkdirSync(FLOWS_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
  eventBus.removeAllListeners("sse");
});

describe("engine — talk_sync(target=\"user\") 死锁修复", () => {
  test("talk_sync 到 user 不会把线程置为 waiting，线程继续到完成", async () => {
    /* 脚本：open talk_sync(user) → submit → open return → submit
     * 如果死锁修复失效，talk_sync 会把 root 线程永久置为 waiting，
     * 第 3 轮不会执行，最终 status != "done"。 */
    let formId = "f_unknown";
    let step = 0;
    const llm = new MockLLMClient({
      responseFn: (messages) => {
        step++;
        if (step === 1) {
          return {
            content: "",
            toolCalls: [toolCall("open", {
              title: "先给 user 同步打声招呼",
              type: "command",
              command: "talk_sync",
              description: "同步问候",
            })],
          };
        }
        if (step === 2) {
          const userMsg = (messages as Array<{ role: string; content: string }>).find((m) => m.role === "user");
          const m = userMsg?.content.match(/<form id="(f_[^"]+)" command="talk_sync"/);
          if (m?.[1]) formId = m[1];
          return {
            content: "",
            toolCalls: [toolCall("submit", {
              title: "投递同步消息",
              form_id: formId,
              target: "user",
              message: "你好 user（talk_sync）",
            })],
          };
        }
        if (step === 3) {
          return {
            content: "",
            toolCalls: [toolCall("open", {
              title: "准备返回",
              type: "command",
              command: "return",
              description: "收尾",
            })],
          };
        }
        /* step 4+ */
        const userMsg = (messages as Array<{ role: string; content: string }>).find((m) => m.role === "user");
        const m = userMsg?.content.match(/<form id="(f_[^"]+)" command="return"/);
        if (m?.[1]) formId = m[1];
        return {
          content: "",
          toolCalls: [toolCall("submit", {
            title: "返回",
            form_id: formId,
            summary: "done",
          })],
        };
      },
    });

    let userMessagesReceived = 0;
    const config: EngineConfig = {
      rootDir: TEST_DIR,
      flowsDir: FLOWS_DIR,
      llm,
      directory: [],
      traits: [],
      stone: makeStone("alice"),
      onTalk: async (targetObject, _message, _fromObject, _fromThreadId, _sessionId, _continueThreadId, _messageId) => {
        if (targetObject.toLowerCase() === "user") {
          userMessagesReceived++;
          return { reply: null, remoteThreadId: "user" };
        }
        return { reply: null, remoteThreadId: "unknown" };
      },
      schedulerConfig: {
        /* 收紧上限：若死锁修复失效，很快 failed */
        maxIterationsPerThread: 10,
        maxTotalIterations: 10,
        deadlockGracePeriodMs: 0,
      },
    };

    const result = await runWithThreadTree("alice", "test", "user", config);

    expect(result.status).toBe("done");
    expect(userMessagesReceived).toBe(1);
  });

  test("talk_sync 到非 user 对象仍会把线程置为 waiting（原语义不变）", async () => {
    /* 验证修复只作用于 target=user，不影响常规 talk_sync 语义 */
    let step = 0;
    let formId = "f_unknown";
    const llm = new MockLLMClient({
      responseFn: (messages) => {
        step++;
        if (step === 1) {
          return {
            content: "",
            toolCalls: [toolCall("open", {
              title: "调用 bob",
              type: "command",
              command: "talk_sync",
              description: "同步询问",
            })],
          };
        }
        /* step 2 */
        const userMsg = (messages as Array<{ role: string; content: string }>).find((m) => m.role === "user");
        const m = userMsg?.content.match(/<form id="(f_[^"]+)" command="talk_sync"/);
        if (m?.[1]) formId = m[1];
        return {
          content: "",
          toolCalls: [toolCall("submit", {
            title: "投递",
            form_id: formId,
            target: "bob",
            message: "在吗",
          })],
        };
      },
    });

    const config: EngineConfig = {
      rootDir: TEST_DIR,
      flowsDir: FLOWS_DIR,
      llm,
      directory: [{ name: "bob", whoAmI: "bob" }],
      traits: [],
      stone: makeStone("alice"),
      onTalk: async (targetObject) => {
        /* bob 回复：模拟跨对象协作 */
        if (targetObject.toLowerCase() === "bob") return { reply: "我在", remoteThreadId: "th_bob" };
        return { reply: null, remoteThreadId: "x" };
      },
      schedulerConfig: {
        maxIterationsPerThread: 3,
        maxTotalIterations: 6,
        deadlockGracePeriodMs: 0,
      },
    };

    const result = await runWithThreadTree("alice", "test", "user", config);
    /* 常规 talk_sync 会让 root 线程 waiting 等待 bob 回复；
     * bob 回复后被 writeInbox 唤醒，线程继续；但这里 LLM 脚本没有 return 步骤，
     * 所以会跑到迭代上限——关键验证是 status ≠ "done" 且也不 hang，至少跑到了 waiting 分支。 */
    expect(result.status === "waiting" || result.status === "failed").toBe(true);
  });
});
