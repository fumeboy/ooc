import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, test } from "bun:test";
import {
  createFlowObject,
  llmInputFile,
  llmOutputFile,
  loopMetaFile,
  threadFile
} from "../../persistable";
import type { ThreadContext } from "../context";
import type { LlmClient, LlmGenerateResult, LlmToolCall } from "../llm/types";
import { runScheduler } from "../scheduler";
import { clearObservableDebugState, disableDebug, enableDebug } from "../../observable";

function makeResult(text: string, toolCalls: LlmToolCall[] = []): LlmGenerateResult {
  return {
    provider: "openai",
    model: "test",
    outputItems: [
      ...(text ? [{ type: "message", role: "assistant", content: text } as const] : []),
      ...toolCalls.map((toolCall) => ({
        type: "function_call" as const,
        call_id: toolCall.id,
        name: toolCall.name,
        arguments: toolCall.arguments
      }))
    ],
    text,
    toolCalls
  };
}

describe("single object runtime", () => {
  let tempRoot: string | undefined;

  afterEach(async () => {
    if (tempRoot) {
      await rm(tempRoot, { recursive: true, force: true });
      tempRoot = undefined;
    }
  });

  test("runs thinkable, executable, observable, and persistable in one object", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-single-object-"));
    const flowRef = await createFlowObject({
      baseDir: tempRoot,
      sessionId: "s1",
      objectId: "assistant"
    });
    const root: ThreadContext = {
      id: "root",
      status: "running",
      events: [],
      contextWindows: [],
      persistence: { ...flowRef, threadId: "root" }
    };

    let callCount = 0;
    const llmClient: LlmClient = {
      async generate() {
        callCount += 1;
        if (callCount === 1) {
          // C 规则触发：args 给齐 plan，自动 submit；下一轮无需再 submit
          return makeResult("I will set the plan via C-rule.", [
            {
              id: "tc1",
              name: "open",
              arguments: {
                title: "open plan",
                command: "plan",
                description: "制定本对象执行计划",
                args: { plan: "完成单 object 最小闭环" }
              }
            }
          ]);
        }

        return makeResult("All done.", []);
      },
      async *stream() {
        yield { type: "start", provider: "openai", model: "test" };
        yield { type: "done", text: "", toolCalls: [] };
      }
    };

    clearObservableDebugState();
    enableDebug();
    await runScheduler(root, llmClient, { maxTicks: 2 });
    disableDebug();

    const ref = root.persistence!;
    const input = JSON.parse(await readFile(llmInputFile(ref), "utf8"));
    const output = JSON.parse(await readFile(llmOutputFile(ref), "utf8"));
    const loopMeta = JSON.parse(await readFile(loopMetaFile(ref, 2), "utf8"));
    const savedThread = JSON.parse(await readFile(threadFile(ref), "utf8"));

    expect(input.threadId).toBe("root");
    // C 规则下 round 1 直接执行 plan；round 2 没有任何工具调用，所以 outputItems 只有 message
    expect(loopMeta.loopIndex).toBe(2);
    expect(loopMeta.status).toBe("ok");
    expect(root.plan).toBe("完成单 object 最小闭环");
    expect(savedThread.plan).toBe("完成单 object 最小闭环");
    expect(
      savedThread.events.some(
        (event: { category: string; kind: string }) =>
          event.category === "llm_interaction" && event.kind === "function_call"
      )
    ).toBe(true);
    void output;
  });
});
