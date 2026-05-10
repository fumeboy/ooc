import { describe, expect, it } from "bun:test";
import * as observableModule from "../index";
import type { ThreadContext } from "../../thinkable/context";
import type { LlmGenerateResult, LlmMessage, LlmTool } from "../../thinkable/llm/types";

type ObservableStore = typeof observableModule & {
  clearLatestLlmObservation: () => void;
  getLatestLlmObservation: () =>
    | {
        input?: {
          threadId: string;
          messages: LlmMessage[];
          tools: LlmTool[];
        };
        output?: {
          threadId: string;
          result: LlmGenerateResult;
        };
      }
    | undefined;
};

describe("observable llm snapshots", () => {
  it("records latest llm input and output for a thread", async () => {
    const observable = observableModule as ObservableStore;
    expect(typeof observable.clearLatestLlmObservation).toBe("function");
    expect(typeof observable.getLatestLlmObservation).toBe("function");

    const thread: ThreadContext = {
      id: "thread-observable",
      status: "running",
      events: []
    };
    const messages: LlmMessage[] = [{ role: "system", content: "<context></context>" }];
    const tools: LlmTool[] = [
      {
        name: "wait",
        description: "等待",
        inputSchema: { type: "object" }
      }
    ];
    const result: LlmGenerateResult = {
      provider: "openai",
      model: "gpt-test",
      text: "下一步需要等待",
      toolCalls: []
    };

    observable.clearLatestLlmObservation();
    await observable.writeLatestLlmInput(thread, messages, tools);
    await observable.writeLatestLlmOutput(thread, result);

    expect(observable.getLatestLlmObservation()).toEqual({
      input: {
        threadId: "thread-observable",
        messages,
        tools
      },
      output: {
        threadId: "thread-observable",
        result
      }
    });
  });
});
