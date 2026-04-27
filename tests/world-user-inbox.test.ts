/**
 * World → user inbox 集成测试
 *
 * 验证：当对象通过线程树 engine 调 talk(target="user") 时，
 * flows/{sessionId}/user/data.json 会被追加 { threadId, messageId } 引用。
 *
 * @ref docs/工程管理/迭代/all/20260421_feature_user_inbox.md
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

import { runWithThreadTree, type EngineConfig } from "../src/thinkable/engine/engine.js";
import { MockLLMClient, type ToolCall } from "../src/thinkable/client.js";
import type { StoneData } from "../src/types/index.js";
import { eventBus } from "../src/observable/server/events.js";
import { readUserInbox } from "../src/storable/inbox/user-inbox.js";

const TEST_DIR = join(import.meta.dir, ".tmp_world_user_inbox_test");
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

/**
 * 构造一个 onTalk 回调，模拟 world.ts 的 handleOnTalkToUser 行为：
 *   - target=user 时写 user inbox
 *   - 其他 target 暂不支持
 * （真实 World 里 handleOnTalkToUser 是 closure，此处直接 inline 简化）
 */
function makeUserOnlyOnTalk(flowsDir: string, capturedInbox: Array<{ threadId: string; messageId: string }>) {
  return async (
    targetObject: string,
    _message: string,
    _fromObject: string,
    fromThreadId: string,
    sessionId: string,
    _continueThreadId: string | undefined,
    messageId: string | undefined,
  ) => {
    if (targetObject.toLowerCase() === "user" && fromThreadId && messageId) {
      const { appendUserInbox } = await import("../src/storable/inbox/user-inbox.js");
      await appendUserInbox(flowsDir, sessionId, fromThreadId, messageId);
      capturedInbox.push({ threadId: fromThreadId, messageId });
    }
    return { reply: null as null, remoteThreadId: "user" };
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

describe("World → user inbox 集成", () => {
  test("单次 talk(user) 后 inbox 有一条引用，messageId 可在 thread.json 反查", async () => {
    let step = 0;
    let formId = "f_unknown";

    const llm = new MockLLMClient({
      responseFn: (messages) => {
        step++;
        const user = (messages as Array<{ role: string; content: string }>).find((m) => m.role === "user")?.content ?? "";
        if (step === 1) {
          return { content: "", toolCalls: [toolCall("open", { title: "准备招呼", type: "command", command: "talk", description: "招呼 user" })] };
        }
        if (step === 2) {
          const m = user.match(/<form id="(f_[^"]+)" command="talk"/); if (m?.[1]) formId = m[1];
          return { content: "", toolCalls: [toolCall("submit", { title: "问好 user", form_id: formId, target: "user", message: "你好 user" })] };
        }
        if (step === 3) {
          return { content: "", toolCalls: [toolCall("open", { title: "准备结束", type: "command", command: "return", description: "return" })] };
        }
        const m2 = user.match(/<form id="(f_[^"]+)" command="return"/); if (m2?.[1]) formId = m2[1];
        return { content: "", toolCalls: [toolCall("submit", { title: "完成", form_id: formId, summary: "done" })] };
      },
    });

    const captured: Array<{ threadId: string; messageId: string }> = [];
    const config: EngineConfig = {
      rootDir: TEST_DIR,
      flowsDir: FLOWS_DIR,
      llm,
      directory: [],
      traits: [],
      stone: makeStone("alice"),
      onTalk: makeUserOnlyOnTalk(FLOWS_DIR, captured),
      schedulerConfig: { maxIterationsPerThread: 10, maxTotalIterations: 10, deadlockGracePeriodMs: 0 },
    };

    const result = await runWithThreadTree("alice", "hi", "user", config);
    expect(result.status).toBe("done");

    /* 1. inbox 有一条，且 messageId 格式正确 */
    const data = await readUserInbox(FLOWS_DIR, result.sessionId);
    expect(data.inbox.length).toBe(1);
    const entry = data.inbox[0]!;
    expect(entry.messageId).toMatch(/^msg_/);
    expect(entry.threadId).toMatch(/^th_|^root$/); /* 首次 talk 在 root 线程发起 */

    /* 2. 反查：在发起对象的 thread.json 里能找到同 id 的 message_out action */
    const threadJsonPath = join(FLOWS_DIR, result.sessionId, "objects", "alice", "threads", entry.threadId, "thread.json");
    expect(existsSync(threadJsonPath)).toBe(true);
    const thread = JSON.parse(await Bun.file(threadJsonPath).text());
    const msgOut = (thread.actions as Array<{ id?: string; type: string; content?: string }>).find(
      (a) => a.type === "message_out" && a.id === entry.messageId,
    );
    expect(msgOut).toBeDefined();
    expect(msgOut!.content).toContain("你好 user");
  });

  test("user/data.json 的 inbox 字段是追加语义（同 session 内两次 talk 有两条）", async () => {
    /* 手动调两次 talk（不通过 engine）以隔离测试 */
    const { appendUserInbox } = await import("../src/storable/inbox/user-inbox.js");
    const sid = "s_append_test";
    await appendUserInbox(FLOWS_DIR, sid, "th_1", "msg_1");
    await appendUserInbox(FLOWS_DIR, sid, "th_1", "msg_2");
    const data = await readUserInbox(FLOWS_DIR, sid);
    expect(data.inbox).toEqual([
      { threadId: "th_1", messageId: "msg_1" },
      { threadId: "th_1", messageId: "msg_2" },
    ]);
  });
});
