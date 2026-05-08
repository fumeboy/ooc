import { afterEach, describe, expect, it, mock, spyOn } from "bun:test";
import * as toolsModule from "../../executable/tools.ts";
import * as observableModule from "../../observable/index.ts";
import * as contextModule from "../context.ts";
import type { LlmClient } from "../llm/types";
import { think } from "../thinkloop.ts";

// 每个用例后恢复 spy，避免跨用例污染占位模块行为。
afterEach(() => {
  mock.restore();
});

describe("think", () => {
  it("执行单轮 think 并记录 text 与 tool_use 事件", async () => {
    const thread: contextModule.ThreadContext = {
      id: "thread-1",
      status: "running",
      events: []
    };

    spyOn(contextModule, "buildContext").mockResolvedValue([
      { role: "system", content: "context" }
    ]);
    spyOn(toolsModule, "getAvailableTools").mockReturnValue([
      {
        name: "wait",
        description: "等待",
        inputSchema: { type: "object" }
      }
    ]);
    const writeInput = spyOn(observableModule, "writeLatestLlmInput");
    const writeOutput = spyOn(observableModule, "writeLatestLlmOutput");
    const dispatch = spyOn(toolsModule, "dispatchToolCall").mockResolvedValue();

    const llmClient: LlmClient = {
      async generate() {
        return {
          provider: "openai",
          model: "gpt-test",
          text: "需要等待",
          toolCalls: [
            {
              id: "call_1",
              name: "wait",
              arguments: { reason: "need input" }
            }
          ]
        };
      },
      async *stream() {
        yield { type: "start", provider: "openai", model: "gpt-test" };
        yield { type: "done", text: "", toolCalls: [] };
      }
    };

    await think(thread, llmClient);

    expect(writeInput).toHaveBeenCalledTimes(1);
    expect(writeOutput).toHaveBeenCalledTimes(1);
    expect(thread.events).toEqual([
      {
        category: "llm_interaction",
        kind: "text",
        text: "需要等待"
      },
      {
        category: "llm_interaction",
        kind: "tool_use",
        toolName: "wait",
        arguments: { reason: "need input" }
      }
    ]);
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it("pause 时在 tool 执行前把线程改为 paused", async () => {
    const thread: contextModule.ThreadContext = {
      id: "thread-2",
      status: "running",
      events: []
    };

    spyOn(contextModule, "buildContext").mockResolvedValue([]);
    spyOn(toolsModule, "getAvailableTools").mockReturnValue([]);
    spyOn(observableModule, "isPausing").mockReturnValue(true);
    const dispatch = spyOn(toolsModule, "dispatchToolCall").mockResolvedValue();

    const llmClient: LlmClient = {
      async generate() {
        return {
          provider: "openai",
          model: "gpt-test",
          text: "暂停前输出",
          toolCalls: []
        };
      },
      async *stream() {
        yield { type: "start", provider: "openai", model: "gpt-test" };
        yield { type: "done", text: "", toolCalls: [] };
      }
    };

    await think(thread, llmClient);

    expect(thread.status).toBe("paused");
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("llm 失败时写入 inject 并把线程改为 failed", async () => {
    const thread: contextModule.ThreadContext = {
      id: "thread-3",
      status: "running",
      events: []
    };

    spyOn(contextModule, "buildContext").mockResolvedValue([]);
    spyOn(toolsModule, "getAvailableTools").mockReturnValue([]);

    const llmClient: LlmClient = {
      async generate() {
        throw new Error("llm exploded");
      },
      async *stream() {
        yield { type: "start", provider: "openai", model: "gpt-test" };
        yield { type: "done", text: "", toolCalls: [] };
      }
    };

    await think(thread, llmClient);

    expect(thread.status).toBe("failed");
    expect(thread.events.at(-1)).toEqual({
      category: "context_change",
      kind: "inject",
      text: "llm exploded"
    });
  });

  it("tool 失败时写入 inject 且停止后续 tool", async () => {
    const thread: contextModule.ThreadContext = {
      id: "thread-4",
      status: "running",
      events: []
    };

    spyOn(contextModule, "buildContext").mockResolvedValue([]);
    spyOn(toolsModule, "getAvailableTools").mockReturnValue([]);
    const dispatch = spyOn(toolsModule, "dispatchToolCall")
      .mockRejectedValueOnce(new Error("first tool failed"))
      .mockResolvedValueOnce();

    const llmClient: LlmClient = {
      async generate() {
        return {
          provider: "claude",
          model: "claude-test",
          text: "",
          toolCalls: [
            { id: "call_1", name: "open", arguments: {} },
            { id: "call_2", name: "close", arguments: {} }
          ]
        };
      },
      async *stream() {
        yield { type: "start", provider: "claude", model: "claude-test" };
        yield { type: "done", text: "", toolCalls: [] };
      }
    };

    await think(thread, llmClient);

    expect(thread.status).toBe("running");
    expect(thread.events.at(-1)).toEqual({
      category: "context_change",
      kind: "inject",
      text: "first tool failed"
    });
    expect(dispatch).toHaveBeenCalledTimes(1);
  });
});
