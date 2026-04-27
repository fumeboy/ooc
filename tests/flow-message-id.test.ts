/**
 * FlowMessage id 字段集成测试
 *
 * 验证目标：当对象调 talk(target="user") 时，前端消费的三个源都带同一个 id：
 * 1. thread.json.actions 的 message_out action 带 id（已有行为，这里加断言兜底）
 * 2. SSE flow:message 事件的 message.id === action.id
 * 3. flows/{sessionId}/user/data.json 的 inbox.messageId === action.id
 *
 * 这三者对齐后，前端（MessageSidebar / TuiTalkForm）能按 id 稳定匹配 FlowMessage → action → form。
 *
 * @ref docs/工程管理/迭代/all/20260421_feature_flow_message_id.md
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

import { runWithThreadTree, type EngineConfig } from "../src/thread/engine.js";
import { MockLLMClient, type ToolCall } from "../src/thinkable/client.js";
import type { StoneData } from "../src/types/index.js";
import { eventBus } from "../src/observable/server/events.js";
import { readUserInbox } from "../src/persistence/user-inbox.js";

const TEST_DIR = join(import.meta.dir, ".tmp_flow_message_id_test");
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

describe("FlowMessage id 字段三源对齐", () => {
  test("talk(user) 后 action / SSE event / inbox 的 id 完全一致", async () => {
    /* 监听 SSE 事件，捕获 flow:message */
    const emittedMessages: Array<{ id?: string; content: string; direction: string }> = [];
    eventBus.on("sse", (evt: unknown) => {
      const e = evt as { type?: string; message?: { id?: string; content: string; direction: string } };
      if (e.type === "flow:message" && e.message) {
        emittedMessages.push({ id: e.message.id, content: e.message.content, direction: e.message.direction });
      }
    });

    let step = 0;
    let formId = "f_unknown";
    const llm = new MockLLMClient({
      responseFn: (messages) => {
        step++;
        const user = (messages as Array<{ role: string; content: string }>).find((m) => m.role === "user")?.content ?? "";
        if (step === 1) {
          return { content: "", toolCalls: [toolCall("open", { title: "打招呼", type: "command", command: "talk", description: "talk user" })] };
        }
        if (step === 2) {
          const m = user.match(/<form id="(f_[^"]+)" command="talk"/); if (m?.[1]) formId = m[1];
          return { content: "", toolCalls: [toolCall("submit", { title: "talk user", form_id: formId, target: "user", message: "你好 user" })] };
        }
        if (step === 3) {
          return { content: "", toolCalls: [toolCall("open", { title: "结束", type: "command", command: "return", description: "done" })] };
        }
        const m2 = user.match(/<form id="(f_[^"]+)" command="return"/); if (m2?.[1]) formId = m2[1];
        return { content: "", toolCalls: [toolCall("submit", { title: "done", form_id: formId, summary: "done" })] };
      },
    });

    /* 模拟 world.handleOnTalkToUser：既写 user inbox，也广播 SSE（带 messageId） */
    const config: EngineConfig = {
      rootDir: TEST_DIR,
      flowsDir: FLOWS_DIR,
      llm,
      directory: [],
      traits: [],
      stone: makeStone("alice"),
      onTalk: async (targetObject, message, fromObject, fromThreadId, sessionId, _continueThreadId, messageId) => {
        if (targetObject.toLowerCase() === "user" && fromThreadId && messageId) {
          const { appendUserInbox } = await import("../src/persistence/user-inbox.js");
          const { emitSSE } = await import("../src/observable/server/events.js");
          await appendUserInbox(FLOWS_DIR, sessionId, fromThreadId, messageId);
          emitSSE({
            type: "flow:message",
            objectName: fromObject,
            sessionId,
            message: {
              id: messageId,
              direction: "out",
              from: fromObject,
              to: "user",
              content: message,
              timestamp: Date.now(),
            },
          });
        }
        return { reply: null, remoteThreadId: "user" };
      },
      schedulerConfig: { maxIterationsPerThread: 10, maxTotalIterations: 10, deadlockGracePeriodMs: 0 },
    };

    const result = await runWithThreadTree("alice", "hi", "user", config);
    expect(result.status).toBe("done");

    /* 1. user inbox 一条 */
    const data = await readUserInbox(FLOWS_DIR, result.sessionId);
    expect(data.inbox.length).toBe(1);
    const inboxEntry = data.inbox[0]!;
    expect(inboxEntry.messageId).toMatch(/^msg_/);

    /* 2. action.id === inbox.messageId */
    const threadJsonPath = join(FLOWS_DIR, result.sessionId, "objects", "alice", "threads", inboxEntry.threadId, "thread.json");
    expect(existsSync(threadJsonPath)).toBe(true);
    const thread = JSON.parse(await Bun.file(threadJsonPath).text());
    const msgOut = (thread.actions as Array<{ id?: string; type: string; content?: string }>).find(
      (a) => a.type === "message_out" && a.id === inboxEntry.messageId,
    );
    expect(msgOut).toBeDefined();
    expect(msgOut!.content).toContain("你好 user");

    /* 3. SSE event.message.id === action.id */
    const matchedEmitted = emittedMessages.find((m) => m.id === inboxEntry.messageId);
    expect(matchedEmitted).toBeDefined();
    expect(matchedEmitted!.direction).toBe("out");
    expect(matchedEmitted!.content).toBe("你好 user");
  });
});
