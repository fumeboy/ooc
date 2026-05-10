import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, test } from "bun:test";
import { createFlowObject, llmInputFile, llmOutputFile, threadFile } from "../../persistable";
import type { ThreadContext } from "../context";
import type { LlmClient } from "../llm/types";
import { runScheduler } from "../scheduler";

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
      activeForms: [],
      persistence: { ...flowRef, threadId: "root" }
    };

    let callCount = 0;
    const llmClient: LlmClient = {
      async generate() {
        callCount += 1;
        if (callCount === 1) {
          return {
            provider: "openai",
            model: "test",
            text: "I will open a plan form.",
            toolCalls: [
              {
                id: "tc1",
                name: "open",
                arguments: {
                  title: "open plan",
                  type: "command",
                  command: "plan",
                  description: "制定本对象执行计划",
                  args: { plan: "完成单 object 最小闭环" }
                }
              }
            ]
          };
        }

        return {
          provider: "openai",
          model: "test",
          text: "I will submit the plan.",
          toolCalls: [
            {
              id: "tc2",
              name: "submit",
              arguments: {
                title: "提交计划",
                form_id: root.activeForms?.[0]?.formId ?? ""
              }
            }
          ]
        };
      },
      async *stream() {
        yield { type: "start", provider: "openai", model: "test" };
        yield { type: "done", text: "", toolCalls: [] };
      }
    };

    await runScheduler(root, llmClient, { maxTicks: 2 });

    const ref = root.persistence!;
    const input = JSON.parse(await readFile(llmInputFile(ref), "utf8"));
    const output = JSON.parse(await readFile(llmOutputFile(ref), "utf8"));
    const savedThread = JSON.parse(await readFile(threadFile(ref), "utf8"));

    expect(input.threadId).toBe("root");
    expect(output.result.toolCalls[0]?.name).toBe("submit");
    expect(root.plan).toBe("完成单 object 最小闭环");
    expect(savedThread.plan).toBe("完成单 object 最小闭环");
    expect(
      savedThread.events.some(
        (event: { category: string; kind: string }) =>
          event.category === "llm_interaction" && event.kind === "tool_use"
      )
    ).toBe(true);
  });
});
