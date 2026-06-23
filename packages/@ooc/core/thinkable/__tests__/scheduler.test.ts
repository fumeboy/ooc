import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "bun:test";
import type { LlmClient, LlmGenerateResult, LlmToolCall } from "../llm/types";
import type { ThreadContext } from "@ooc/builtins/agent/thread/types.js";
import { runScheduler } from "../scheduler";
import { createFlowObject } from "../../persistable";
import { threadFile } from "@ooc/builtins/agent/thread/persistable/thread-json";
import { makeThread } from "../../__tests__/make-thread";

function makeResult(
  provider: "openai" | "claude",
  model: string,
  text: string,
  toolCalls: LlmToolCall[] = [],
): LlmGenerateResult {
  return {
    provider,
    model,
    outputItems: [
      ...(text ? [{ type: "message", role: "assistant", content: text } as const] : []),
      ...toolCalls.map((toolCall) => ({
        type: "function_call" as const,
        call_id: toolCall.id,
        name: toolCall.name,
        arguments: toolCall.arguments,
      })),
    ],
    text,
    toolCalls,
  };
}

/**
 * scheduler 在 ContextWindow 模型下的行为：
 * - 子线程 done/failed 时 scheduler 主动给父 inbox 写一条 system 消息
 * - inbox 长度增长后，waiting 父线程自动翻回 running
 */
describe("scheduler", () => {
  it("wakes a waiting parent after the awaited child finishes (inbox-based)", async () => {
    const child: ThreadContext = makeThread({
      id: "t_child",
      status: "done",
      parentThreadId: "t_parent",
      creatorThreadId: "t_parent",
    });
    child.endReason = "done";
    child.endSummary = "child finished";

    const parent: ThreadContext = makeThread({
      id: "t_parent",
      status: "waiting",
      inbox: [],
    });
    parent.inboxSnapshotAtWait = 0;
    parent.childThreadIds = ["t_child"];
    parent.childThreads = { t_child: child };

    const llmClient: LlmClient = {
      async generate() {
        return makeResult("openai", "gpt-test", "");
      },
    };

    await runScheduler(parent, llmClient, { maxTicks: 2 });

    // scheduler 应该已经给父 inbox 写了 child 结束通知，并把父翻回 running
    expect(parent.status).toBe("running");
    expect(parent.inboxSnapshotAtWait).toBeUndefined();
    expect((parent.inbox ?? []).some((m) => m.content.includes("child finished"))).toBe(true);
  });

  it("runs the oldest running thread first by lastExecutedAt", async () => {
    const childOld: ThreadContext = makeThread({ id: "t_old" });
    childOld.lastExecutedAt = 10;
    const childNew: ThreadContext = makeThread({ id: "t_new" });
    childNew.lastExecutedAt = 20;
    const root: ThreadContext = makeThread({ id: "t_root", status: "waiting" });
    root.inboxSnapshotAtWait = 0;
    root.childThreads = { t_new: childNew, t_old: childOld };

    const executed: string[] = [];
    const llmClient: LlmClient = {
      async generate({ input }) {
        const system = input[0] && "content" in input[0] ? input[0].content : "";
        if (system.includes('id="t_old"')) executed.push("t_old");
        if (system.includes('id="t_new"')) executed.push("t_new");
        return {
          provider: "openai",
          model: "gpt-test",
          outputItems: [],
          text: "",
          toolCalls: [],
        };
      },
    };

    await runScheduler(root, llmClient, { maxTicks: 1 });
    expect(executed).toEqual(["t_old"]);
  });
});

describe("scheduler persistence", () => {
  let tempRoot: string | undefined;

  afterEach(async () => {
    if (tempRoot) {
      await rm(tempRoot, { recursive: true, force: true });
      tempRoot = undefined;
    }
  });

  it("persists a thread after it is executed", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-scheduler-"));
    const flowRef = await createFlowObject({
      baseDir: tempRoot,
      sessionId: "s1",
      objectId: "obj",
    });
    const root: ThreadContext = makeThread({
      id: "root",
      persistence: { ...flowRef, threadId: "root" },
    });
    const llmClient: LlmClient = {
      async generate() {
        return makeResult("openai", "gpt-test", "persisted");
      },
    };

    await runScheduler(root, llmClient, { maxTicks: 1 });

    const saved = JSON.parse(await readFile(threadFile(root.persistence!), "utf8"));
    expect(saved.events.at(-1)).toEqual({
      category: "llm_interaction",
      kind: "text",
      text: "persisted",
    });
  });
});
