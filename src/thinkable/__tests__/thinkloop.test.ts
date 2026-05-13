import { afterEach, describe, expect, it, mock, spyOn } from "bun:test";
import * as toolsModule from "../../executable/tools.ts";
import * as observableModule from "../../observable/index.ts";
import * as contextModule from "../context.ts";
import type { LlmClient, LlmGenerateResult, LlmInputItem, LlmToolCall } from "../llm/types";
import { think } from "../thinkloop.ts";

function makeResult(
  provider: "openai" | "claude",
  model: string,
  text: string,
  toolCalls: LlmToolCall[] = []
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
        arguments: toolCall.arguments
      }))
    ],
    text,
    toolCalls
  };
}

// 每个用例后恢复 spy，避免跨用例污染占位模块行为。
afterEach(() => {
  mock.restore();
  observableModule.clearLatestLlmObservation();
});

describe("think", () => {
  it("执行单轮 think 并记录 text、function_call 与 function_call_output 事件", async () => {
    const thread: contextModule.ThreadContext = {
      id: "thread-1",
      status: "running",
      events: []
    };

    spyOn(contextModule, "buildInputItems").mockResolvedValue({
      input: [{ type: "message", role: "system", content: "context" }]
    });
    spyOn(toolsModule, "getAvailableTools").mockReturnValue([
      {
        name: "wait",
        description: "等待",
        inputSchema: { type: "object" }
      }
    ]);
    const writeInput = spyOn(observableModule, "writeLatestLlmInput");
    const writeOutput = spyOn(observableModule, "writeLatestLlmOutput");
    const dispatch = spyOn(toolsModule, "dispatchToolCall").mockResolvedValue(
      JSON.stringify({ ok: true, tool: "wait" })
    );

    const llmClient: LlmClient = {
      async generate() {
        return makeResult("openai", "gpt-test", "需要等待", [
          {
            id: "call_1",
            name: "wait",
            arguments: { reason: "need input" }
          }
        ]);
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
        kind: "function_call",
        callId: "call_1",
        toolName: "wait",
        arguments: { reason: "need input" }
      },
      {
        category: "tool_runtime",
        kind: "function_call_output",
        callId: "call_1",
        toolName: "wait",
        output: expect.any(String),
        ok: true
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

    spyOn(contextModule, "buildInputItems").mockResolvedValue({ input: [] });
    spyOn(toolsModule, "getAvailableTools").mockReturnValue([]);
    spyOn(observableModule, "isPausing").mockReturnValue(true);
    const dispatch = spyOn(toolsModule, "dispatchToolCall").mockResolvedValue(
      JSON.stringify({ ok: true, tool: "wait" })
    );

    const llmClient: LlmClient = {
      async generate() {
        return makeResult("openai", "gpt-test", "暂停前输出");
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

    spyOn(contextModule, "buildInputItems").mockResolvedValue({ input: [] });
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

    spyOn(contextModule, "buildInputItems").mockResolvedValue({ input: [] });
    spyOn(toolsModule, "getAvailableTools").mockReturnValue([]);
    const dispatch = spyOn(toolsModule, "dispatchToolCall")
      .mockRejectedValueOnce(new Error("first tool failed"))
      .mockResolvedValueOnce(JSON.stringify({ ok: true, tool: "close" }));

    const llmClient: LlmClient = {
      async generate() {
        return makeResult("claude", "claude-test", "", [
          { id: "call_1", name: "open", arguments: {} },
          { id: "call_2", name: "close", arguments: {} }
        ]);
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

  it("text-only response does not implicitly wait without a wait tool call", async () => {
    const thread: contextModule.ThreadContext = {
      id: "thread-text-only",
      status: "running",
      events: [
        {
          category: "llm_interaction",
          kind: "text",
          text: "你好！我是一个 AI 助手。"
        }
      ]
    };

    spyOn(contextModule, "buildInputItems").mockResolvedValue({ input: [] });
    spyOn(toolsModule, "getAvailableTools").mockReturnValue([]);

    const llmClient: LlmClient = {
      async generate() {
        return makeResult("openai", "gpt-test", "你好！我是一个 AI 助手。");
      },
      async *stream() {
        yield { type: "start", provider: "openai", model: "gpt-test" };
        yield { type: "done", text: "", toolCalls: [] };
      }
    };

    await think(thread, llmClient);

    expect(thread.status).toBe("running");
    expect(thread.waitingType).toBeUndefined();
    expect(
      thread.events.filter((event) =>
        event.category === "llm_interaction" &&
        event.kind === "text" &&
        event.text === "你好！我是一个 AI 助手。"
      )
    ).toHaveLength(1);
  });

  it("连续多轮 think 可以跑通 open refine submit 与 todo command execute", async () => {
    const thread: contextModule.ThreadContext = {
      id: "thread-5",
      status: "running",
      events: []
    };

    let round = 0;
    const llmClient: LlmClient = {
      async generate() {
        round += 1;

        if (round === 1) {
          return makeResult("openai", "gpt-test", "先登记一个待办", [
            {
              id: "call_open",
              name: "open",
              arguments: {
                type: "command",
                command: "todo",
                description: "登记 thinkloop 集成待办"
              }
            }
          ]);
        }

        const formId = thread.activeForms?.[0]?.formId ?? "";
        if (round === 2) {
          return makeResult("openai", "gpt-test", "补充待办内容", [
            {
              id: "call_refine",
              name: "refine",
              arguments: {
                form_id: formId,
                args: {
                  content: "补充 thinkloop 集成测试",
                  on_command_path: ["program.function"]
                }
              }
            }
          ]);
        }

        return makeResult("openai", "gpt-test", "提交待办", [
          {
            id: "call_submit",
            name: "submit",
            arguments: {
              form_id: formId
            }
          }
        ]);
      },
      async *stream() {
        yield { type: "start", provider: "openai", model: "gpt-test" };
        yield { type: "done", text: "", toolCalls: [] };
      }
    };

    await think(thread, llmClient);
    expect(thread.activeForms).toHaveLength(1);
    expect(thread.activeForms?.[0]?.command).toBe("todo");

    await think(thread, llmClient);
    expect(thread.activeForms?.[0]?.accumulatedArgs).toEqual({
      content: "补充 thinkloop 集成测试",
      on_command_path: ["program.function"]
    });

    await think(thread, llmClient);
    expect(thread.activeForms).toHaveLength(1);
    expect(thread.activeForms?.[0]?.status).toBe("executed");
    const executedEvent = [...thread.events].reverse().find(
      (event) => event.category === "tool_runtime" && event.kind === "function_call_output"
    );
    expect(executedEvent?.category).toBe("tool_runtime");
    expect(executedEvent?.kind).toBe("function_call_output");
    expect(executedEvent && "output" in executedEvent ? executedEvent.output : "").toContain("[form executed]");
  });

  it("buildInputItems 产出的 system xml 会进入 llm 输入", async () => {
    const thread: contextModule.ThreadContext = {
      id: "thread-6",
      status: "running",
      events: [
        {
          category: "llm_interaction",
          kind: "text",
          text: "上一轮已经检查过日志"
        },
        {
          category: "llm_interaction",
          kind: "tool_use",
          toolName: "wait",
          arguments: {
            reason: "等待用户补充"
          }
        },
        {
          category: "context_change",
          kind: "inject",
          text: "系统注入了新的上下文"
        }
      ],
      inbox: [
        {
          id: "msg_in_1",
          fromThreadId: "t_child",
          toThreadId: "thread-6",
          content: "请处理我的结果",
          createdAt: 1,
          source: "do"
        }
      ],
      outbox: [
        {
          id: "msg_out_1",
          fromThreadId: "thread-6",
          toThreadId: "t_child",
          content: "先去检查日志",
          createdAt: 2,
          source: "do"
        }
      ]
    };

    const writeInput = spyOn(observableModule, "writeLatestLlmInput");
    spyOn(toolsModule, "getAvailableTools").mockReturnValue([]);

    const llmClient: LlmClient = {
      async generate() {
        return makeResult("openai", "gpt-test", "");
      },
      async *stream() {
        yield { type: "start", provider: "openai", model: "gpt-test" };
        yield { type: "done", text: "", toolCalls: [] };
      }
    };

    await think(thread, llmClient);

    const inputItems = writeInput.mock.calls[0]?.[1] as LlmInputItem[] | undefined;
    const firstItem = inputItems?.[0];
    expect(firstItem).toEqual(expect.objectContaining({ type: "message", role: "system" }));
    const firstContent = firstItem && firstItem.type === "message" ? firstItem.content : "";
    expect(firstContent).toContain("<context>");
    expect(firstContent).toContain("<inbox>");
    expect(firstContent).toContain("请处理我的结果");
    expect(firstContent).toContain("<outbox>");
    expect(firstContent).toContain("先去检查日志");
    expect(firstContent).not.toContain("上一轮已经检查过日志");
    // tool_use 和普通 inject 事件都不进 transcript，只保留结构化/必要事件。
    expect(inputItems?.slice(1)).toEqual([
      {
        type: "message",
        role: "assistant",
        content: "上一轮已经检查过日志"
      }
    ]);
  });

  it("observable 记录的 llm 输入输出可以检查 think 过程", async () => {
    const thread: contextModule.ThreadContext = {
      id: "thread-7",
      status: "running",
      events: [
        {
          category: "llm_interaction",
          kind: "text",
          text: "上一轮输出"
        }
      ]
    };
    const llmResult = {
      ...makeResult("openai", "gpt-test", "本轮输出", [
        {
          id: "call_wait",
          name: "wait" as const,
          arguments: {
            reason: "等待检查"
          }
        }
      ])
    };

    spyOn(toolsModule, "getAvailableTools").mockReturnValue([
      {
        name: "wait",
        description: "等待",
        inputSchema: { type: "object" }
      }
    ]);
    const dispatch = spyOn(toolsModule, "dispatchToolCall").mockResolvedValue(
      JSON.stringify({ ok: true, tool: "wait" })
    );
    observableModule.clearLatestLlmObservation();

    const llmClient: LlmClient = {
      async generate({ input, tools }) {
        const actualTools = tools ?? [];
        const observation = observableModule.getLatestLlmObservation();
        expect(observation?.input).toEqual({
          threadId: "thread-7",
          inputItems: input,
          tools: actualTools
        });
        expect(observation?.output).toBeUndefined();
        return llmResult;
      },
      async *stream() {
        yield { type: "start", provider: "openai", model: "gpt-test" };
        yield { type: "done", text: "", toolCalls: [] };
      }
    };

    await think(thread, llmClient);

    const observation = observableModule.getLatestLlmObservation();
    expect(observation?.input?.threadId).toBe("thread-7");
    const observedFirstItem = observation?.input?.inputItems?.[0];
    expect(observedFirstItem).toEqual(expect.objectContaining({ type: "message", role: "system" }));
    const observedFirstContent = observedFirstItem && observedFirstItem.type === "message"
      ? observedFirstItem.content
      : "";
    expect(observedFirstContent).toContain('<thread id="thread-7" status="running">');
    expect(observedFirstContent).toContain('<knowledge path="internal/executable/basic">');
    expect(observation?.input?.inputItems?.[1]).toEqual({
      type: "message",
      role: "assistant",
      content: "上一轮输出"
    });
    expect(observation?.input?.tools).toHaveLength(1);
    expect(observation?.output).toEqual({
      threadId: "thread-7",
      outputItems: [
        {
          type: "message",
          role: "assistant",
          content: "本轮输出"
        },
        {
          type: "function_call",
          call_id: "call_wait",
          name: "wait",
          arguments: {
            reason: "等待检查"
          }
        }
      ],
      provider: "openai",
      model: "gpt-test"
    });
    expect(thread.events.at(-3)).toEqual({
      category: "llm_interaction",
      kind: "text",
      text: "本轮输出"
    });
    expect(thread.events.at(-2)).toEqual({
      category: "llm_interaction",
      kind: "function_call",
      callId: "call_wait",
      toolName: "wait",
      arguments: {
        reason: "等待检查"
      }
    });
    expect(thread.events.at(-1)).toEqual({
      category: "tool_runtime",
      kind: "function_call_output",
      callId: "call_wait",
      toolName: "wait",
      output: JSON.stringify({ ok: true, tool: "wait" }),
      ok: true
    });
    expect(dispatch).toHaveBeenCalledTimes(1);
  });
});
